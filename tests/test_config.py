import pytest

from app.config import Settings


def test_settings_reject_short_signing_key() -> None:
    with pytest.raises(ValueError, match="at least 48 characters"):
        Settings(jwt_signing_keys_json='{"current":"short"}', jwt_active_key_id="current")


def test_settings_require_active_key() -> None:
    with pytest.raises(ValueError, match="JWT_ACTIVE_KEY_ID"):
        Settings(jwt_signing_keys_json='{"old":"a-signing-key-that-is-at-least-forty-eight-characters-long"}', jwt_active_key_id="current")


def test_production_security_fails_closed() -> None:
    with pytest.raises(ValueError, match="non-development"):
        Settings(environment="production")


def production_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "environment": "production",
        "jwt_signing_keys_json": '{"current":"a-production-signing-key-that-is-at-least-forty-eight-characters-long"}',
        "jwt_active_key_id": "current",
        "cookie_secure": True,
        "email_sender": "resend",
        "resend_api_key": "test-resend-key",
        "email_verification_required": True,
        "invitation_delivery": "email",
        "password_reset_delivery": "email",
        "public_app_url": "https://app.example.com",
        "allowed_hosts": "app.example.com",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_security_accepts_complete_configuration() -> None:
    settings = production_settings()

    assert settings.environment == "production"


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"email_verification_required": False}, "EMAIL_VERIFICATION_REQUIRED"),
        ({"invitation_delivery": "manual"}, "INVITATION_DELIVERY"),
        ({"password_reset_delivery": "disabled"}, "PASSWORD_RESET_DELIVERY"),
        ({"public_app_url": "http://app.example.com"}, "HTTPS PUBLIC_APP_URL"),
        ({"allowed_hosts": "localhost,app.example.com"}, "ALLOWED_HOSTS"),
    ],
)
def test_production_security_rejects_unsafe_customer_configuration(
    override: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        production_settings(**override)


def test_development_security_defaults() -> None:
    settings = Settings()
    assert settings.jwt_active_key_id == "development"
    assert settings.access_token_minutes == 15
    assert settings.refresh_token_days == 30
    assert settings.email_verification_required is False
    assert settings.invitation_delivery == "manual"
    assert settings.password_reset_delivery == "disabled"
    assert settings.vision_model == "qwen/qwen3-vl-4b"
    assert settings.mineru_enabled is True
    assert settings.classification_auto_accept_threshold == 0.85
    assert settings.classification_review_threshold == 0.60


def test_invitation_delivery_rejects_unknown_mode() -> None:
    with pytest.raises(ValueError, match="INVITATION_DELIVERY"):
        Settings(invitation_delivery="carrier-pigeon")


def test_password_reset_delivery_rejects_unknown_mode() -> None:
    with pytest.raises(ValueError, match="PASSWORD_RESET_DELIVERY"):
        Settings(password_reset_delivery="manual-public-link")


def test_classification_review_threshold_must_be_lower_than_auto_accept() -> None:
    with pytest.raises(ValueError, match="CLASSIFICATION_REVIEW_THRESHOLD"):
        Settings(
            classification_auto_accept_threshold=0.75,
            classification_review_threshold=0.75,
        )
