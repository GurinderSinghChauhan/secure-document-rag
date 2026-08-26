from collections.abc import AsyncIterator

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import get_settings


class Base(DeclarativeBase):
    pass


class OrganizationRecord(Base):
    __tablename__ = "organizations"

    organization_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), index=True)
    trial_started_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    trial_ends_at: Mapped[object] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserRecord(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(512))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_super_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), index=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MembershipRecord(Base):
    __tablename__ = "organization_memberships"
    __table_args__ = (UniqueConstraint("user_id", name="uq_membership_user"),)

    membership_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.organization_id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RefreshSessionRecord(Base):
    __tablename__ = "refresh_sessions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    family_id: Mapped[str] = mapped_column(String(36), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[object] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AccountTokenRecord(Base):
    __tablename__ = "account_tokens"

    token_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    purpose: Mapped[str] = mapped_column(String(24), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.organization_id"), nullable=True)
    role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    expires_at: Mapped[object] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentRecord(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("tenant_id", "content_sha256", name="uq_document_tenant_content_hash"),)

    document_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    document_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(255))
    content_sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    chunk_count: Mapped[int] = mapped_column(Integer)
    document_type: Mapped[str | None] = mapped_column(String(96), nullable=True, index=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    extraction_status: Mapped[str] = mapped_column(String(24), default="not_requested", server_default=text("'not_requested'"), index=True)
    extracted_metadata: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, server_default=text("'{}'::json"))
    allowed_roles: Mapped[list[str]] = mapped_column(JSON)
    allowed_users: Mapped[list[str]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ComputeSessionRecord(Base):
    __tablename__ = "compute_sessions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), index=True)
    max_jobs: Mapped[int] = mapped_column(Integer)
    max_gpu_minutes: Mapped[float] = mapped_column(Float)
    max_estimated_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    released_job_count: Mapped[int] = mapped_column(Integer, default=0)
    gpu_seconds: Mapped[float] = mapped_column(Float, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0)
    created_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    closed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)


class IngestionJobRecord(Base):
    __tablename__ = "ingestion_jobs"

    job_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    state: Mapped[str] = mapped_column(String(32), index=True)
    stage: Mapped[str] = mapped_column(String(32), default="held")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(String(500), default="GPU processing is off; document saved and waiting.")
    document_name: Mapped[str] = mapped_column(String(255))
    document_type: Mapped[str | None] = mapped_column(String(96), nullable=True, index=True)
    content_type: Mapped[str] = mapped_column(String(255))
    content_sha256: Mapped[str] = mapped_column(String(64), index=True)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    size_bytes: Mapped[int] = mapped_column(Integer)
    allowed_roles: Mapped[list[str]] = mapped_column(JSON)
    allowed_users: Mapped[list[str]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(255))
    compute_session_id: Mapped[str | None] = mapped_column(ForeignKey("compute_sessions.session_id"), nullable=True, index=True)
    provider_job_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    retry_limit: Mapped[int] = mapped_column(Integer, default=3)
    result_document_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    chunks_indexed: Mapped[int] = mapped_column(Integer, default=0)
    tables_indexed: Mapped[int] = mapped_column(Integer, default=0)
    visuals_indexed: Mapped[int] = mapped_column(Integer, default=0)
    gpu_seconds: Mapped[float] = mapped_column(Float, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_events"

    event_id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    details: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ChatSessionRecord(Base):
    __tablename__ = "chat_sessions"

    chat_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ChatMessageRecord(Base):
    __tablename__ = "chat_messages"

    message_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    chat_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.chat_id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ChatResponseEvaluationRecord(Base):
    __tablename__ = "chat_response_evaluations"
    __table_args__ = (
        UniqueConstraint("response_message_id", name="uq_chat_response_evaluation_message"),
        CheckConstraint("correctness BETWEEN 1 AND 5", name="ck_chat_evaluation_correctness"),
        CheckConstraint("relevance BETWEEN 1 AND 5", name="ck_chat_evaluation_relevance"),
        CheckConstraint("clarity BETWEEN 1 AND 5", name="ck_chat_evaluation_clarity"),
    )

    evaluation_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    response_message_id: Mapped[str] = mapped_column(ForeignKey("chat_messages.message_id", ondelete="CASCADE"), index=True)
    evaluator_user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    correctness: Mapped[int] = mapped_column(Integer)
    relevance: Mapped[int] = mapped_column(Integer)
    clarity: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


engine = create_async_engine(get_settings().database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def initialize_database() -> None:
    async with engine.connect() as connection:
        migrated = await connection.scalar(text("SELECT to_regclass('public.organizations') IS NOT NULL"))
        if not migrated:
            raise RuntimeError("Database schema is not migrated; run `alembic upgrade head`")


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        yield session


async def dispose_database() -> None:
    await engine.dispose()
