from datetime import UTC, datetime, timedelta
from hashlib import sha256
import secrets
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import MembershipRecord, OrganizationRecord, UserRecord, get_session
from .models import Principal

password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
bearer = HTTPBearer(auto_error=False)


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def hash_token(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def random_token() -> str:
    return secrets.token_urlsafe(48)


def create_access_token(user: UserRecord, membership: MembershipRecord) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": user.user_id,
            "org_id": membership.organization_id,
            "role": membership.role,
            "super_admin": bool(user.is_super_admin),
            "ver": user.token_version,
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "jti": str(uuid4()),
        },
        settings.jwt_signing_keys[settings.jwt_active_key_id],
        algorithm="HS256",
        headers={"kid": settings.jwt_active_key_id, "typ": "JWT"},
    )


def decode_access_token(token: str) -> dict[str, object]:
    settings = get_settings()
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        if header.get("alg") != "HS256" or kid not in settings.jwt_signing_keys:
            raise jwt.InvalidTokenError("Invalid signing key")
        return jwt.decode(token, settings.jwt_signing_keys[str(kid)], algorithms=["HS256"], issuer=settings.jwt_issuer, audience=settings.jwt_audience)
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token") from error


async def require_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> Principal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    claims = decode_access_token(credentials.credentials)
    user = await session.get(UserRecord, str(claims.get("sub")))
    if user is None or not user.active or not user.email_verified or user.token_version != claims.get("ver"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired access token")
    membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user.user_id))
    if membership is None or membership.organization_id != claims.get("org_id") or membership.role != claims.get("role"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization has changed; sign in again")
    if bool(claims.get("super_admin")) != bool(user.is_super_admin):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization has changed; sign in again")
    organization = await session.get(OrganizationRecord, membership.organization_id)
    if organization is None or (not organization.active and not user.is_super_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization is suspended")
    return Principal(tenant_id=membership.organization_id, user_id=user.user_id, roles=[membership.role], is_super_admin=bool(user.is_super_admin), trial_ends_at=organization.trial_ends_at)


def require_admin(principal: Principal) -> Principal:
    if "admin" not in principal.roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator role required")
    return principal


def require_super_admin(principal: Principal) -> Principal:
    if not principal.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super administrator role required")
    return principal
