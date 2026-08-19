from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
import re
from time import monotonic
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import record
from .auth import create_access_token, hash_password, hash_token, normalize_email, random_token, require_admin, require_principal, verify_password
from .config import get_settings
from .database import AccountTokenRecord, MembershipRecord, OrganizationRecord, RefreshSessionRecord, UserRecord, get_session
from .email_sender import send_account_email
from .models import Principal

router = APIRouter(prefix="/v1")
GENERIC_EMAIL_MESSAGE = "If the account is eligible, an email has been sent."
REFRESH_COOKIE = "secure_rag_refresh"
limits: dict[str, deque[float]] = defaultdict(deque)


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=128)
    organization_name: str = Field(min_length=2, max_length=120)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        value = normalize_email(value)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address")
        return value


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)


class TokenRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)


class ResetPasswordRequest(TokenRequest):
    password: str = Field(min_length=12, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: str


class InvitationAcceptRequest(TokenRequest):
    display_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=128)


class InvitationCreateRequest(BaseModel):
    email: str
    role: str = "member"

    @field_validator("role")
    @classmethod
    def valid_role(cls, value: str) -> str:
        if value not in {"admin", "member"}:
            raise ValueError("Role must be admin or member")
        return value


class RoleUpdateRequest(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def valid_role(cls, value: str) -> str:
        if value not in {"admin", "member"}:
            raise ValueError("Role must be admin or member")
        return value


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict[str, object]


def rate_limit(request: Request, bucket: str, maximum: int = 10, window: int = 60) -> None:
    key = f"{bucket}:{request.client.host if request.client else 'unknown'}"
    now = monotonic()
    entries = limits[key]
    while entries and entries[0] < now - window:
        entries.popleft()
    if len(entries) >= maximum:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests; try again later")
    entries.append(now)


def validate_cookie_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    allowed_origins = {urlparse(get_settings().public_app_url).netloc, request.headers.get("host", "")}
    if origin and urlparse(origin).netloc not in allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request origin")


def set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE, token, max_age=settings.refresh_token_days * 86400, httponly=True,
        secure=settings.cookie_secure, samesite="lax", path="/v1/auth",
    )


async def membership_for(session: AsyncSession, user_id: str) -> MembershipRecord:
    membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user_id))
    if membership is None:
        raise HTTPException(status_code=401, detail="Account has no organization")
    return membership


async def auth_response(session: AsyncSession, response: Response, user: UserRecord, family_id: str | None = None) -> AuthResponse:
    settings = get_settings()
    membership = await membership_for(session, user.user_id)
    organization = await session.get(OrganizationRecord, membership.organization_id)
    if not organization.active and not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Organization is suspended")
    refresh = random_token()
    session.add(RefreshSessionRecord(
        session_id=str(uuid4()), family_id=family_id or str(uuid4()), user_id=user.user_id,
        token_hash=hash_token(refresh), expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
    ))
    await session.commit()
    set_refresh_cookie(response, refresh)
    return AuthResponse(
        access_token=create_access_token(user, membership), expires_in=settings.access_token_minutes * 60,
        user={"user_id": user.user_id, "email": user.email, "display_name": user.display_name, "role": membership.role, "is_super_admin": bool(user.is_super_admin),
              "organization": {"organization_id": organization.organization_id, "name": organization.name, "slug": organization.slug}},
    )


async def create_account_token(session: AsyncSession, *, purpose: str, email: str, hours: int, user_id: str | None = None, organization_id: str | None = None, role: str | None = None) -> str:
    token = random_token()
    session.add(AccountTokenRecord(token_id=str(uuid4()), token_hash=hash_token(token), purpose=purpose, email=email,
                                   user_id=user_id, organization_id=organization_id, role=role,
                                   expires_at=datetime.now(UTC) + timedelta(hours=hours)))
    await session.commit()
    return token


def organization_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return (slug or "organization")[:64].rstrip("-")


async def available_organization_slug(session: AsyncSession, name: str) -> str:
    base = organization_slug(name)
    if await session.scalar(select(OrganizationRecord.organization_id).where(OrganizationRecord.slug == base)) is None:
        return base
    return f"{base[:55].rstrip('-')}-{uuid4().hex[:8]}"


@router.post("/auth/register", status_code=202)
async def register(payload: RegisterRequest, request: Request, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    rate_limit(request, "register", 5, 3600)
    settings = get_settings()
    organization_id, user_id = str(uuid4()), str(uuid4())
    slug = await available_organization_slug(session, payload.organization_name)
    user = UserRecord(
        user_id=user_id, email=payload.email, display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password), email_verified=not settings.email_verification_required,
    )
    session.add(OrganizationRecord(organization_id=organization_id, name=payload.organization_name.strip(), slug=slug))
    session.add(user)
    try:
        await session.flush()
        session.add(MembershipRecord(membership_id=str(uuid4()), organization_id=organization_id, user_id=user_id, role="admin"))
        await session.commit()
    except IntegrityError:
        await session.rollback()
        if settings.email_verification_required:
            return {"message": GENERIC_EMAIL_MESSAGE}
        return {"message": "Account could not be created. Try signing in, or use a different email address."}
    if settings.email_verification_required:
        token = await create_account_token(session, purpose="verify_email", email=user.email, hours=24, user_id=user.user_id, organization_id=organization_id)
        await send_account_email(user.email, "Verify your account", f"{settings.public_app_url}/?verify={token}")
    await record(session, "account_registered", organization_id, user_id)
    return {"message": GENERIC_EMAIL_MESSAGE if settings.email_verification_required else "Account created. You can now sign in."}


@router.post("/auth/verify-email")
async def verify_email(payload: TokenRequest, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    token = await valid_account_token(session, payload.token, "verify_email")
    user = await session.get(UserRecord, token.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user.email_verified = True
    token.used_at = datetime.now(UTC)
    await session.commit()
    await record(session, "email_verified", token.organization_id or "unknown", user.user_id)
    return {"message": "Email verified. You can now sign in."}


@router.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest, request: Request, response: Response, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    rate_limit(request, "login", 10, 300)
    user = await session.scalar(select(UserRecord).where(UserRecord.email == normalize_email(payload.email)))
    if user is None or not verify_password(user.password_hash, payload.password) or not user.active or not user.email_verified:
        if user is not None:
            membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user.user_id))
            if membership is not None:
                await record(session, "login_failed", membership.organization_id, user.user_id)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    result = await auth_response(session, response, user)
    membership = await membership_for(session, user.user_id)
    await record(session, "login_succeeded", membership.organization_id, user.user_id)
    return result


@router.post("/auth/refresh", response_model=AuthResponse)
async def refresh(request: Request, response: Response, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    rate_limit(request, "refresh", 30, 60)
    validate_cookie_origin(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    stored = await session.scalar(select(RefreshSessionRecord).where(RefreshSessionRecord.token_hash == hash_token(raw or "")))
    now = datetime.now(UTC)
    if stored is None:
        raise HTTPException(status_code=401, detail="Refresh session expired")
    if stored.revoked_at is not None or stored.replaced_by_hash is not None:
        await session.execute(update(RefreshSessionRecord).where(RefreshSessionRecord.family_id == stored.family_id).values(revoked_at=now))
        await session.commit()
        membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == stored.user_id))
        if membership is not None:
            await record(session, "refresh_token_reuse_detected", membership.organization_id, stored.user_id)
        raise HTTPException(status_code=401, detail="Refresh session expired")
    if stored.expires_at < now:
        raise HTTPException(status_code=401, detail="Refresh session expired")
    user = await session.get(UserRecord, stored.user_id)
    if user is None or not user.active or not user.email_verified:
        raise HTTPException(status_code=401, detail="Refresh session expired")
    membership = await membership_for(session, user.user_id)
    organization = await session.get(OrganizationRecord, membership.organization_id)
    if not organization.active and not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Organization is suspended")
    new_refresh = random_token()
    new_hash = hash_token(new_refresh)
    stored.revoked_at, stored.replaced_by_hash = now, new_hash
    settings = get_settings()
    session.add(RefreshSessionRecord(session_id=str(uuid4()), family_id=stored.family_id, user_id=user.user_id, token_hash=new_hash, expires_at=now + timedelta(days=settings.refresh_token_days)))
    await session.commit()
    set_refresh_cookie(response, new_refresh)
    return AuthResponse(access_token=create_access_token(user, membership), expires_in=settings.access_token_minutes * 60,
                        user={"user_id": user.user_id, "email": user.email, "display_name": user.display_name, "role": membership.role, "is_super_admin": bool(user.is_super_admin),
                              "organization": {"organization_id": organization.organization_id, "name": organization.name, "slug": organization.slug}})


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, session: AsyncSession = Depends(get_session)) -> Response:
    validate_cookie_origin(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        stored = await session.scalar(select(RefreshSessionRecord).where(RefreshSessionRecord.token_hash == hash_token(raw)))
        if stored:
            stored.revoked_at = datetime.now(UTC)
            await session.commit()
            membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == stored.user_id))
            if membership is not None:
                await record(session, "logout", membership.organization_id, stored.user_id)
    response.delete_cookie(REFRESH_COOKIE, path="/v1/auth")
    response.status_code = 204
    return response


@router.post("/auth/forgot-password", status_code=202)
async def forgot_password(payload: ForgotPasswordRequest, request: Request, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    rate_limit(request, "forgot", 5, 3600)
    settings = get_settings()
    if settings.password_reset_delivery == "disabled":
        return {"message": "Password recovery is currently disabled. Contact your organization administrator."}
    user = await session.scalar(select(UserRecord).where(UserRecord.email == normalize_email(payload.email)))
    if user and user.active:
        token = await create_account_token(session, purpose="password_reset", email=user.email, hours=1, user_id=user.user_id)
        await send_account_email(user.email, "Reset your password", f"{settings.public_app_url}/?reset={token}")
    return {"message": GENERIC_EMAIL_MESSAGE}


async def valid_account_token(session: AsyncSession, raw: str, purpose: str) -> AccountTokenRecord:
    token = await session.scalar(select(AccountTokenRecord).where(AccountTokenRecord.token_hash == hash_token(raw), AccountTokenRecord.purpose == purpose))
    if token is None or token.used_at is not None or token.revoked_at is not None or token.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    return token


@router.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordRequest, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    token = await valid_account_token(session, payload.token, "password_reset")
    user = await session.get(UserRecord, token.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user.password_hash = hash_password(payload.password)
    user.token_version += 1
    token.used_at = datetime.now(UTC)
    await session.execute(update(RefreshSessionRecord).where(RefreshSessionRecord.user_id == user.user_id, RefreshSessionRecord.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    await session.commit()
    membership = await membership_for(session, user.user_id)
    await record(session, "password_reset", membership.organization_id, user.user_id)
    return {"message": "Password updated. Sign in with your new password."}


@router.get("/auth/me")
async def me(principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    user = await session.get(UserRecord, principal.user_id)
    membership = await membership_for(session, principal.user_id)
    organization = await session.get(OrganizationRecord, membership.organization_id)
    return {"user_id": user.user_id, "email": user.email, "display_name": user.display_name, "role": membership.role, "is_super_admin": bool(user.is_super_admin),
            "organization": {"organization_id": organization.organization_id, "name": organization.name, "slug": organization.slug}}


@router.post("/admin/organization/invitations", status_code=202)
async def invite(payload: InvitationCreateRequest, request: Request, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    require_admin(principal)
    rate_limit(request, f"invite:{principal.tenant_id}", 30, 3600)
    email = normalize_email(payload.email)
    settings = get_settings()
    response_payload = {
        "message": GENERIC_EMAIL_MESSAGE if settings.invitation_delivery == "email"
        else "No invitation was created. This email may already have an account."
    }
    if await session.scalar(select(UserRecord).where(UserRecord.email == email)) is None:
        token = await create_account_token(session, purpose="invitation", email=email, hours=72, organization_id=principal.tenant_id, role=payload.role)
        invitation_url = f"{settings.public_app_url}/?invite={token}"
        if settings.invitation_delivery == "email":
            await send_account_email(email, "Join your organization", invitation_url)
        else:
            response_payload = {"message": "Invitation created. Copy and share this link securely.", "invitation_url": invitation_url}
    await record(session, "invitation_created", principal.tenant_id, principal.user_id, role=payload.role)
    return response_payload


@router.get("/admin/organization/invitations")
async def list_invitations(principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> list[dict[str, object]]:
    require_admin(principal)
    invitations = list(await session.scalars(select(AccountTokenRecord).where(
        AccountTokenRecord.purpose == "invitation", AccountTokenRecord.organization_id == principal.tenant_id,
        AccountTokenRecord.used_at.is_(None), AccountTokenRecord.revoked_at.is_(None),
    ).order_by(AccountTokenRecord.created_at.desc())))
    return [{"invitation_id": item.token_id, "email": item.email, "role": item.role, "expires_at": item.expires_at} for item in invitations]


@router.post("/admin/organization/invitations/{invitation_id}/revoke")
async def revoke_invitation(invitation_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    require_admin(principal)
    invitation = await session.scalar(select(AccountTokenRecord).where(AccountTokenRecord.token_id == invitation_id, AccountTokenRecord.organization_id == principal.tenant_id, AccountTokenRecord.purpose == "invitation"))
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    invitation.revoked_at = datetime.now(UTC)
    await session.commit()
    await record(session, "invitation_revoked", principal.tenant_id, principal.user_id, invitation_id=invitation_id)
    return {"status": "revoked"}


@router.post("/admin/organization/invitations/{invitation_id}/resend", status_code=202)
async def resend_invitation(invitation_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    require_admin(principal)
    invitation = await session.scalar(select(AccountTokenRecord).where(AccountTokenRecord.token_id == invitation_id, AccountTokenRecord.organization_id == principal.tenant_id, AccountTokenRecord.purpose == "invitation"))
    if invitation is None or invitation.used_at is not None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    invitation.revoked_at = datetime.now(UTC)
    await session.commit()
    token = await create_account_token(session, purpose="invitation", email=invitation.email, hours=72, organization_id=principal.tenant_id, role=invitation.role)
    settings = get_settings()
    invitation_url = f"{settings.public_app_url}/?invite={token}"
    if settings.invitation_delivery == "email":
        await send_account_email(invitation.email, "Join your organization", invitation_url)
    await record(session, "invitation_resent", principal.tenant_id, principal.user_id, invitation_id=invitation_id)
    if settings.invitation_delivery == "manual":
        return {"message": "New invitation created. Copy and share this link securely.", "invitation_url": invitation_url}
    return {"message": GENERIC_EMAIL_MESSAGE}


@router.post("/auth/accept-invitation", status_code=201)
async def accept_invitation(payload: InvitationAcceptRequest, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    token = await valid_account_token(session, payload.token, "invitation")
    user = UserRecord(user_id=str(uuid4()), email=token.email, display_name=payload.display_name.strip(), password_hash=hash_password(payload.password), email_verified=True)
    session.add(user)
    try:
        await session.flush()
        session.add(MembershipRecord(membership_id=str(uuid4()), organization_id=token.organization_id, user_id=user.user_id, role=token.role or "member"))
        token.used_at = datetime.now(UTC)
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status_code=400, detail="Invalid or expired token") from error
    await record(session, "invitation_accepted", token.organization_id or "unknown", user.user_id)
    return {"message": "Account created. You can now sign in."}


@router.get("/admin/organization/members")
async def members(principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> list[dict[str, object]]:
    require_admin(principal)
    rows = (await session.execute(select(UserRecord, MembershipRecord).join(MembershipRecord, MembershipRecord.user_id == UserRecord.user_id).where(MembershipRecord.organization_id == principal.tenant_id).order_by(UserRecord.display_name))).all()
    return [{"user_id": user.user_id, "email": user.email, "display_name": user.display_name, "role": membership.role, "active": user.active} for user, membership in rows]


async def ensure_not_last_admin(session: AsyncSession, membership: MembershipRecord) -> None:
    if membership.role != "admin":
        return
    active_admins = await session.scalar(select(func.count()).select_from(MembershipRecord).join(UserRecord).where(MembershipRecord.organization_id == membership.organization_id, MembershipRecord.role == "admin", UserRecord.active.is_(True)))
    if active_admins <= 1:
        raise HTTPException(status_code=409, detail="The final active administrator cannot be changed")


@router.patch("/admin/organization/members/{user_id}/role")
async def change_role(user_id: str, payload: RoleUpdateRequest, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    require_admin(principal)
    membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user_id, MembershipRecord.organization_id == principal.tenant_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if membership.role == "admin" and payload.role != "admin":
        await ensure_not_last_admin(session, membership)
    membership.role = payload.role
    user = await session.get(UserRecord, user_id)
    user.token_version += 1
    await session.commit()
    await record(session, "member_role_changed", principal.tenant_id, principal.user_id, target_user_id=user_id, role=payload.role)
    return {"status": "updated"}


@router.post("/admin/organization/members/{user_id}/deactivate")
async def deactivate(user_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    require_admin(principal)
    membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user_id, MembershipRecord.organization_id == principal.tenant_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="Member not found")
    await ensure_not_last_admin(session, membership)
    user = await session.get(UserRecord, user_id)
    user.active = False
    user.token_version += 1
    await session.execute(update(RefreshSessionRecord).where(RefreshSessionRecord.user_id == user_id, RefreshSessionRecord.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    await session.commit()
    await record(session, "member_deactivated", principal.tenant_id, principal.user_id, target_user_id=user_id)
    return {"status": "deactivated"}


@router.post("/admin/organization/members/{user_id}/revoke-sessions")
async def revoke_sessions(user_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    require_admin(principal)
    membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user_id, MembershipRecord.organization_id == principal.tenant_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="Member not found")
    user = await session.get(UserRecord, user_id)
    user.token_version += 1
    await session.execute(update(RefreshSessionRecord).where(RefreshSessionRecord.user_id == user_id, RefreshSessionRecord.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
    await session.commit()
    await record(session, "member_sessions_revoked", principal.tenant_id, principal.user_id, target_user_id=user_id)
    return {"status": "revoked"}
