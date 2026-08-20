from datetime import datetime

from pydantic import BaseModel, Field


class Principal(BaseModel):
    tenant_id: str
    user_id: str
    roles: list[str]
    is_super_admin: bool = False
    trial_ends_at: datetime | None = None


class QueryRequest(BaseModel):
    question: str = Field(min_length=3, max_length=8_000)
    top_k: int = Field(default=5, ge=1, le=20)
    chat_id: str | None = Field(default=None, min_length=36, max_length=36)


class QueryResponse(BaseModel):
    answer: str
    chat_id: str


class ChatSummary(BaseModel):
    chat_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class ChatMessage(BaseModel):
    role: str
    content: str
    created_at: datetime


class ChatDetail(ChatSummary):
    messages: list[ChatMessage]


class IngestResponse(BaseModel):
    document_id: str
    chunks_indexed: int
    tables_indexed: int = 0
    visuals_indexed: int = 0
    reindexed: bool = False


class HeldIngestResponse(BaseModel):
    job_id: str
    state: str = "held_for_compute"
    message: str


class IngestionJobResponse(BaseModel):
    job_id: str
    document_name: str
    state: str
    stage: str
    progress: int
    message: str
    compute_session_id: str | None
    result_document_id: str | None
    chunks_indexed: int
    tables_indexed: int
    visuals_indexed: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class ComputeSessionCreate(BaseModel):
    max_jobs: int = Field(ge=1, le=10_000)
    max_gpu_minutes: float = Field(gt=0, le=100_000)
    max_estimated_cost_usd: float | None = Field(default=None, gt=0)


class ComputeSessionRelease(BaseModel):
    job_ids: list[str] = Field(min_length=1, max_length=10_000)


class ComputeSessionResponse(BaseModel):
    session_id: str
    status: str
    provider: str
    max_jobs: int
    max_gpu_minutes: float
    max_estimated_cost_usd: float | None
    released_job_count: int
    gpu_seconds: float
    estimated_cost_usd: float
    jobs: list[IngestionJobResponse] = Field(default_factory=list)


class DeleteResponse(BaseModel):
    document_id: str
    status: str


class IndexedDocumentResponse(BaseModel):
    document_id: str
    document_name: str
    content_type: str
    size_bytes: int
    chunk_count: int
    allowed_roles: list[str]
    allowed_users: list[str]
    created_by: str
    created_at: datetime


class ReadinessResponse(BaseModel):
    status: str
    components: dict[str, str]
