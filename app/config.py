from functools import lru_cache
import json

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+asyncpg://secure_rag:secure_rag@postgres:5432/secure_rag"
    qdrant_url: str = "http://localhost:6333"
    model_server_url: str = "http://localhost:1234/v1"
    embedding_model: str = "text-embedding-nomic-embed-text-v1.5"
    chat_model: str = "qwen/qwen3-4b-2507"
    vision_model: str = "qwen/qwen3-vl-4b"
    mineru_enabled: bool = True
    mineru_url: str = "http://localhost:8000"
    mineru_backend: str = "pipeline"
    mineru_timeout_seconds: float = Field(default=600, ge=30, le=3_600)
    mineru_max_output_bytes: int = Field(default=104_857_600, ge=1_048_576, le=1_073_741_824)
    mineru_visual_enrichment_min_characters: int = Field(default=80, ge=0, le=2_000)
    max_upload_bytes: int = 26_214_400
    max_document_chunks: int = 2_000
    max_visuals_per_document: int = Field(default=40, ge=0, le=200)
    visual_analysis_concurrency: int = Field(default=2, ge=1, le=8)
    vision_max_tokens: int = Field(default=512, ge=128, le=2_048)
    embedding_batch_size: int = Field(default=128, ge=1, le=256)
    max_context_characters: int = 24_000
    min_retrieval_score: float = Field(default=0.25, ge=-1, le=1)
    allowed_hosts: str = "localhost,127.0.0.1"
    gpu_dispatch_enabled: bool = False
    compute_provider: str = "local_docker"
    compute_gpu_hourly_cost_usd: float = Field(default=0, ge=0)
    compute_retry_limit: int = Field(default=3, ge=0, le=10)
    compute_worker_profile: str = "nvidia-16gb-qwen3-vl-4b-quantized"
    compute_fallback_profile: str = "nvidia-24gb-qwen3-vl-4b-quantized"
    runpod_api_key: str | None = None
    runpod_endpoint_id: str | None = None
    runpod_api_base_url: str = "https://api.runpod.ai/v2"
    jwt_signing_keys_json: str = '{"development":"development-only-signing-key-change-before-production-1234567890"}'
    jwt_active_key_id: str = "development"
    jwt_issuer: str = "secure-document-rag"
    jwt_audience: str = "secure-document-rag-ui"
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_days: int = Field(default=30, ge=1, le=90)
    public_app_url: str = "http://localhost:8080"
    cookie_secure: bool = False
    email_verification_required: bool = False
    invitation_delivery: str = "manual"
    password_reset_delivery: str = "disabled"
    email_sender: str = "console"
    resend_api_key: str | None = None
    email_from_address: str = "noreply@example.invalid"

    @property
    def jwt_signing_keys(self) -> dict[str, str]:
        parsed = json.loads(self.jwt_signing_keys_json)
        if not isinstance(parsed, dict) or self.jwt_active_key_id not in parsed:
            raise ValueError("JWT_SIGNING_KEYS_JSON must contain JWT_ACTIVE_KEY_ID")
        if any(not isinstance(value, str) or len(value) < 48 for value in parsed.values()):
            raise ValueError("JWT signing keys must contain at least 48 characters")
        return parsed

    @model_validator(mode="after")
    def validate_security_configuration(self) -> "Settings":
        keys = self.jwt_signing_keys
        if self.environment == "production":
            if any("development-only" in key for key in keys.values()):
                raise ValueError("Production requires non-development JWT signing keys")
            if not self.cookie_secure:
                raise ValueError("Production requires COOKIE_SECURE=true")
            if self.email_sender != "resend" or not self.resend_api_key:
                raise ValueError("Production requires Resend email configuration")
        return self

    @field_validator("invitation_delivery")
    @classmethod
    def validate_invitation_delivery(cls, value: str) -> str:
        if value not in {"manual", "email"}:
            raise ValueError("INVITATION_DELIVERY must be manual or email")
        return value

    @field_validator("password_reset_delivery")
    @classmethod
    def validate_password_reset_delivery(cls, value: str) -> str:
        if value not in {"disabled", "email"}:
            raise ValueError("PASSWORD_RESET_DELIVERY must be disabled or email")
        return value

    @field_validator("allowed_hosts")
    @classmethod
    def validate_allowed_hosts(cls, value: str) -> str:
        if not [host for host in value.split(",") if host.strip()]:
            raise ValueError("ALLOWED_HOSTS must not be empty")
        return value

    @field_validator("compute_provider")
    @classmethod
    def validate_compute_provider(cls, value: str) -> str:
        if value not in {"local_docker", "runpod"}:
            raise ValueError("COMPUTE_PROVIDER must be local_docker or runpod")
        return value

    @property
    def allowed_host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
