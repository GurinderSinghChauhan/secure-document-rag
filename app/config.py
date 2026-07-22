from functools import lru_cache
import json

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    tenant_api_keys_json: str
    database_url: str = "postgresql+asyncpg://secure_rag:secure_rag@postgres:5432/secure_rag"
    qdrant_url: str = "http://localhost:6333"
    model_server_url: str = "http://localhost:1234/v1"
    embedding_model: str = "text-embedding-nomic-embed-text-v1.5"
    chat_model: str = "qwen/qwen3-4b-2507"
    max_upload_bytes: int = 26_214_400
    max_document_chunks: int = 2_000
    max_context_characters: int = 24_000
    min_retrieval_score: float = Field(default=0.25, ge=-1, le=1)
    allowed_hosts: str = "localhost,127.0.0.1"

    @property
    def api_keys(self) -> dict[str, dict[str, object]]:
        parsed = json.loads(self.tenant_api_keys_json)
        if not isinstance(parsed, dict) or not parsed:
            raise ValueError("TENANT_API_KEYS_JSON must be a non-empty JSON object")
        if any(api_key.startswith("replace-with-") for api_key in parsed):
            raise ValueError("Replace the example API key before starting the service")
        for api_key, claims in parsed.items():
            if len(api_key) < 32:
                raise ValueError("Each API key must contain at least 32 characters")
            if not isinstance(claims, dict) or not claims.get("tenant_id") or not claims.get("user_id"):
                raise ValueError("Each API key requires tenant_id and user_id claims")
        return parsed

    @model_validator(mode="after")
    def validate_api_key_configuration(self) -> "Settings":
        _ = self.api_keys
        return self

    @field_validator("allowed_hosts")
    @classmethod
    def validate_allowed_hosts(cls, value: str) -> str:
        if not [host for host in value.split(",") if host.strip()]:
            raise ValueError("ALLOWED_HOSTS must not be empty")
        return value

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
