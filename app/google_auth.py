"""Google OIDC sign-in for existing organization accounts."""
from base64 import urlsafe_b64encode
from datetime import UTC, datetime, timedelta
import secrets
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from .accounts import auth_response, membership_for, rate_limit
from .audit import record
from .auth import hash_token, normalize_email, random_token
from .config import get_settings
from .database import AccountTokenRecord, UserRecord, get_session

router = APIRouter(prefix="/v1/auth/google")
STATE_COOKIE = "secure_rag_google_state"
COOKIE_PATH = "/v1/auth/google"


def enabled() -> bool:
    settings = get_settings()
    return bool(settings.google_client_id and settings.google_client_secret)


def redirect_uri() -> str:
    return get_settings().public_app_url.rstrip("/") + "/v1/auth/google/callback"


@router.get("/config")
async def configuration() -> dict[str, bool]:
    return {"enabled": enabled()}


@router.get("/start")
async def start(request: Request, session: AsyncSession = Depends(get_session)) -> RedirectResponse:
    if not enabled():
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    await rate_limit(session, request, "google_login", 10, 300)
    state = random_token()
    session.add(AccountTokenRecord(
        token_id=str(uuid4()), token_hash=hash_token(state), purpose="google_login", email="",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    ))
    await session.commit()
    # The random browser-bound state also supplies the PKCE verifier; only its hash is stored.
    challenge = urlsafe_b64encode(bytes.fromhex(hash_token(state))).rstrip(b"=").decode()
    query = urlencode({
        "client_id": get_settings().google_client_id, "redirect_uri": redirect_uri(),
        "response_type": "code", "scope": "openid email profile", "state": state,
        "nonce": hash_token(state), "code_challenge": challenge,
        "code_challenge_method": "S256", "prompt": "select_account",
    })
    response = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + query, status_code=302)
    response.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True,
                        secure=get_settings().cookie_secure, samesite="lax", path=COOKIE_PATH)
    return response


async def verify_google_code(code: str, state: str) -> dict:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret, "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code", "code_verifier": state,
        })
        response.raise_for_status()
        token = response.json()["id_token"]
        keys = await client.get("https://www.googleapis.com/oauth2/v3/certs")
        keys.raise_for_status()
    header = jwt.get_unverified_header(token)
    key = next((item for item in keys.json()["keys"] if item["kid"] == header.get("kid")), None)
    if key is None:
        raise ValueError("Unknown Google signing key")
    claims = jwt.decode(token, jwt.PyJWK.from_dict(key).key, algorithms=["RS256"],
                        audience=settings.google_client_id,
                        issuer=["https://accounts.google.com", "accounts.google.com"],
                        options={"require": ["exp", "iat", "sub", "email", "email_verified", "nonce"]})
    if (claims["nonce"] != hash_token(state) or claims["email_verified"] is not True
            or not isinstance(claims["sub"], str) or not claims["sub"]
            or not isinstance(claims["email"], str)
            or claims.get("azp", settings.google_client_id) != settings.google_client_id):
        raise ValueError("Invalid Google identity")
    return claims


@router.get("/callback")
async def callback(request: Request, session: AsyncSession = Depends(get_session)) -> RedirectResponse:
    response = RedirectResponse(get_settings().public_app_url.rstrip("/") + "/?google_error=failed", status_code=303)
    response.delete_cookie(STATE_COOKIE, path=COOKIE_PATH)
    state = request.query_params.get("state", "")
    cookie = request.cookies.get(STATE_COOKIE, "")
    if not enabled() or not state or not cookie or not secrets.compare_digest(state, cookie):
        return response
    now = datetime.now(UTC)
    # Consume atomically before contacting Google, preventing concurrent callback replay.
    consumed = await session.scalar(update(AccountTokenRecord).where(
        AccountTokenRecord.token_hash == hash_token(state), AccountTokenRecord.purpose == "google_login",
        AccountTokenRecord.used_at.is_(None), AccountTokenRecord.revoked_at.is_(None),
        AccountTokenRecord.expires_at > now,
    ).values(used_at=now).returning(AccountTokenRecord.token_id))
    await session.commit()
    if consumed is None or request.query_params.get("error") or not request.query_params.get("code"):
        return response
    try:
        claims = await verify_google_code(request.query_params["code"], state)
        user = await session.scalar(select(UserRecord).where(UserRecord.google_subject == claims["sub"]).with_for_update())
        if user is None:
            # Google is authoritative for Gmail and verified Workspace addresses only.
            email = normalize_email(claims["email"])
            if not (email.endswith("@gmail.com") or claims.get("hd")):
                return response
            user = await session.scalar(select(UserRecord).where(UserRecord.email == email).with_for_update())
            if user is None or user.google_subject is not None:
                return response
        if not user.active or not user.email_verified:
            return response
        user.google_subject = claims["sub"]
        await auth_response(session, response, user)
        membership = await membership_for(session, user.user_id)
        await record(session, "google_login_succeeded", membership.organization_id, user.user_id)
    except (httpx.HTTPError, jwt.PyJWTError, ValueError, KeyError, IntegrityError, HTTPException):
        await session.rollback()
        return response
    response.headers["location"] = get_settings().public_app_url.rstrip("/") + "/"
    return response
