from pydantic import BaseModel, Field


class Principal(BaseModel):
    tenant_id: str
    user_id: str
    roles: list[str]


class QueryRequest(BaseModel):
    question: str = Field(min_length=3, max_length=8_000)
    top_k: int = Field(default=5, ge=1, le=20)


class Citation(BaseModel):
    document_id: str
    document_name: str
    chunk_index: int
    score: float


class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]


class IngestResponse(BaseModel):
    document_id: str
    chunks_indexed: int


class DeleteResponse(BaseModel):
    document_id: str
    status: str


class ReadinessResponse(BaseModel):
    status: str
    components: dict[str, str]
