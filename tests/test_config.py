import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_reject_example_api_key() -> None:
    with pytest.raises(ValueError, match="Replace the example API key"):
        Settings(tenant_api_keys_json='{"replace-with-a-real-secret-at-least-32-chars":{"tenant_id":"tenant-a","user_id":"user-a","roles":["admin"]}}')


def test_settings_reject_short_api_key() -> None:
    with pytest.raises(ValueError, match="at least 32 characters"):
        Settings(tenant_api_keys_json='{"short":{"tenant_id":"tenant-a","user_id":"user-a","roles":["admin"]}}')


def test_settings_accepts_valid_api_key_claims() -> None:
    settings = Settings(tenant_api_keys_json='{"valid-api-key-with-more-than-thirty-two-chars":{"tenant_id":"tenant-a","user_id":"user-a","roles":["admin"]}}')
    assert settings.api_keys["valid-api-key-with-more-than-thirty-two-chars"]["tenant_id"] == "tenant-a"
    assert settings.vision_model == "qwen/qwen3-vl-4b"
    assert settings.mineru_enabled is True
    assert settings.mineru_backend == "pipeline"
    assert settings.visual_analysis_concurrency == 2
    assert settings.embedding_batch_size == 128
    assert settings.max_visuals_per_document == 40
