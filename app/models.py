from datetime import datetime

from pydantic import BaseModel, Field


class Principal(BaseModel):
    tenant_id: str
    user_id: str
    roles: list[str]


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


class DeleteResponse(BaseModel):
    document_id: str
    status: str


class ReadinessResponse(BaseModel):
    status: str
    components: dict[str, str]
