from datetime import UTC, datetime
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi import HTTPException, Request

from app.accounts import organization_slug, rate_limit
from app.auth import create_access_token, decode_access_token, hash_password, normalize_email, require_super_admin, verify_password
from app.database import MembershipRecord, RequestLimitRecord, UserRecord
from app.models import Principal


def user() -> UserRecord:
    return UserRecord(user_id="12345678-1234-1234-1234-123456789012", email="user@example.com", display_name="User", password_hash="unused", email_verified=True, active=True, token_version=2)


def membership() -> MembershipRecord:
    return MembershipRecord(membership_id="membership", organization_id="organization", user_id=user().user_id, role="admin")


def test_argon2_password_round_trip():
    encoded = hash_password("a long and secure password")
    assert encoded.startswith("$argon2id$")
    assert verify_password(encoded, "a long and secure password")
    assert not verify_password(encoded, "wrong password")


def test_email_normalization():
    assert normalize_email(" User@Example.COM ") == "user@example.com"


def test_organization_slug_is_generated_from_name():
    assert organization_slug("  Acme Health & Research  ") == "acme-health-research"
    assert organization_slug("研究機構") == "organization"
    assert len(organization_slug("A" * 100)) == 64


def test_access_token_contains_organization_and_role():
    token = create_access_token(user(), membership())
    claims = decode_access_token(token)
    assert claims["org_id"] == "organization"
    assert claims["role"] == "admin"
    assert claims["super_admin"] is False
    assert claims["ver"] == 2
    assert datetime.fromtimestamp(claims["exp"], UTC) > datetime.now(UTC)


def test_access_token_contains_platform_authority():
    platform_user = user()
    platform_user.is_super_admin = True

    claims = decode_access_token(create_access_token(platform_user, membership()))

    assert claims["super_admin"] is True


def test_access_token_rejects_algorithm_confusion():
    token = jwt.encode(
        {"sub": "user"},
        "an-irrelevant-test-key-that-is-long-enough-for-hmac-sha256",
        algorithm="HS256",
        headers={"kid": "unknown"},
    )
    with pytest.raises(Exception, match="Invalid or expired"):
        decode_access_token(token)


def test_super_admin_is_independent_from_organization_role():
    principal = Principal(tenant_id="organization", user_id="user", roles=["member"], is_super_admin=True)
    assert require_super_admin(principal) is principal

    with pytest.raises(Exception, match="Super administrator role required"):
        require_super_admin(Principal(tenant_id="organization", user_id="admin", roles=["admin"]))


def request_from(address: str = "203.0.113.10") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/auth/login",
            "query_string": b"",
            "headers": [],
            "scheme": "https",
            "server": ("app.example.com", 443),
            "client": (address, 50000),
        }
    )


@pytest.mark.asyncio
async def test_shared_rate_limit_increments_an_active_window():
    session = AsyncMock()
    record = RequestLimitRecord(
        limit_key="login:203.0.113.10",
        window_started_at=datetime.now(UTC),
        request_count=2,
    )
    session.get.return_value = record

    await rate_limit(session, request_from(), "login", maximum=10, window=300)

    assert record.request_count == 3
    session.execute.assert_awaited_once()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_shared_rate_limit_rejects_requests_over_the_limit():
    session = AsyncMock()
    session.get.return_value = RequestLimitRecord(
        limit_key="login:203.0.113.10",
        window_started_at=datetime.now(UTC),
        request_count=10,
    )

    with pytest.raises(HTTPException) as raised:
        await rate_limit(session, request_from(), "login", maximum=10, window=300)

    assert raised.value.status_code == 429
    session.rollback.assert_awaited_once()
