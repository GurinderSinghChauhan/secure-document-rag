from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Request
import httpx
import jwt
import pytest

from app import google_auth as google
from app.database import UserRecord


def request(query="", cookie=""):
    return Request({"type": "http", "method": "GET", "path": "/v1/auth/google/callback",
                    "query_string": query.encode(), "headers": [(b"cookie", f"{google.STATE_COOKIE}={cookie}".encode())],
                    "client": ("127.0.0.1", 123), "scheme": "http", "server": ("localhost", 8080)})


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    monkeypatch.setattr(google, "get_settings", lambda: SimpleNamespace(
        google_client_id="client", google_client_secret="secret", public_app_url="http://localhost:8080",
        cookie_secure=False))


@pytest.mark.asyncio
async def test_start_uses_pkce_nonce_and_http_only_cookie():
    session = AsyncMock()
    session.add = lambda value: None
    with patch.object(google, "rate_limit", new=AsyncMock()):
        response = await google.start(request(), session)
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["nonce"] == [google.hash_token(query["state"][0])]
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["http://localhost:8080/v1/auth/google/callback"]
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "Max-Age=600" in response.headers["set-cookie"]


@pytest.mark.asyncio
async def test_callback_rejects_mismatched_state_without_database_access():
    session = AsyncMock()
    response = await google.callback(request("state=wrong&code=code", "right"), session)
    assert "google_error" in response.headers["location"]
    session.scalar.assert_not_called()


@pytest.mark.asyncio
async def test_callback_rejects_consumed_state_without_google_request():
    session = AsyncMock()
    session.scalar.return_value = None
    with patch.object(google, "verify_google_code", new=AsyncMock()) as verify:
        response = await google.callback(request("state=state&code=code", "state"), session)
    verify.assert_not_called()
    assert "google_error" in response.headers["location"]


@pytest.mark.asyncio
@pytest.mark.parametrize("active,verified,success", [(True, True, True), (False, True, False), (True, False, False)])
async def test_callback_preserves_account_eligibility(active, verified, success):
    session = AsyncMock()
    user = UserRecord(user_id="user", google_subject="subject", active=active, email_verified=verified)
    session.scalar.side_effect = ["state-record", user]
    with (patch.object(google, "verify_google_code", new=AsyncMock(return_value={"sub": "subject"})),
          patch.object(google, "auth_response", new=AsyncMock()) as auth,
          patch.object(google, "membership_for", new=AsyncMock(return_value=SimpleNamespace(organization_id="org"))),
          patch.object(google, "record", new=AsyncMock())):
        response = await google.callback(request("state=state&code=code", "state"), session)
    assert auth.await_count == int(success)
    assert ("google_error" not in response.headers["location"]) == success


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{}, {"aud": "attacker"}, {"nonce": "wrong"}, {"email_verified": False}, {"iss": "attacker"}, {"exp": 1}])
async def test_signed_google_identity_validation(change):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk["kid"] = "test"
    now = datetime.now(UTC)
    claims = {"iss": "https://accounts.google.com", "aud": "client", "sub": "subject", "email": "user@gmail.com",
              "email_verified": True, "nonce": google.hash_token("state"), "iat": now, "exp": now + timedelta(minutes=5)}
    claims.update(change)
    token = jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test"})
    def handler(req):
        return httpx.Response(200, json={"id_token": token} if req.url.path == "/token" else {"keys": [jwk]})
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with patch.object(google.httpx, "AsyncClient", return_value=client):
        if change:
            with pytest.raises((jwt.PyJWTError, ValueError)):
                await google.verify_google_code("code", "state")
        else:
            assert (await google.verify_google_code("code", "state"))["sub"] == "subject"


@pytest.mark.asyncio
@pytest.mark.parametrize("email,hd,allowed", [("user@gmail.com", None, True), ("user@company.com", "company.com", True), ("user@example.com", None, False)])
async def test_first_login_only_links_google_authoritative_addresses(email, hd, allowed):
    session = AsyncMock()
    user = UserRecord(user_id="user", google_subject=None, active=True, email_verified=True)
    session.scalar.side_effect = ["state-record", None, user]
    claims = {"sub": "subject", "email": email, "hd": hd}
    with (patch.object(google, "verify_google_code", new=AsyncMock(return_value=claims)),
          patch.object(google, "auth_response", new=AsyncMock()) as auth,
          patch.object(google, "membership_for", new=AsyncMock(return_value=SimpleNamespace(organization_id="org"))),
          patch.object(google, "record", new=AsyncMock())):
        await google.callback(request("state=state&code=code", "state"), session)
    assert auth.await_count == int(allowed)
    assert user.google_subject == ("subject" if allowed else None)
