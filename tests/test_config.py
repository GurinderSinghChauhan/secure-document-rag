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
