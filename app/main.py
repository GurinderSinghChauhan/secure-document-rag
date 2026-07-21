from contextlib import asynccontextmanager
from hashlib import sha256
from pathlib import PurePath
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import record
from .auth import require_admin, require_principal
from .chunking import chunk_text
from .config import get_settings
from .database import DocumentRecord, dispose_database, get_session, initialize_database
from .document_parser import extract_text
from .models import DeleteResponse, Citation, IngestResponse, Principal, QueryRequest, QueryResponse, ReadinessResponse
from .providers import OllamaClient
from .repository import database_is_ready, document_exists, get_document, mark_document_deleted
from .vector_store import VectorStore

ollama = OllamaClient()
vectors = VectorStore()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await initialize_database()
    yield
    await vectors.close()
    await dispose_database()


app = FastAPI(title="Secure Document RAG", version="0.2.0", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=get_settings().allowed_host_list)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def parse_acl(value: str | None) -> list[str]:
    values = [item.strip() for item in (value or "").split(",") if item.strip()]
    if len(values) != len(set(values)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ACL values must be unique")
    return values


def validate_document_name(document_name: str) -> str:
    if PurePath(document_name).name != document_name or any(character in document_name for character in "\r\n\x00"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid document name")
    return document_name


async def read_limited_body(request: Request) -> bytes:
    settings = get_settings()
    declared_size = request.headers.get("content-length")
    if declared_size and int(declared_size) > settings.max_upload_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Document exceeds configured upload limit")
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Document exceeds configured upload limit")
    return bytes(content)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz", response_model=ReadinessResponse)
async def readyz(session: AsyncSession = Depends(get_session)) -> ReadinessResponse:
    components = {
        "database": "ready" if await database_is_ready(session) else "unavailable",
        "qdrant": "ready" if await vectors.is_ready() else "unavailable",
        "ollama": "ready" if await ollama.is_ready() else "unavailable",
    }
    if any(component != "ready" for component in components.values()):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"status": "unavailable", "components": components})
    return ReadinessResponse(status="ready", components=components)


@app.post("/v1/documents", response_model=IngestResponse, status_code=status.HTTP_201_CREATED)
async def ingest_document(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
    x_document_name: str = Header(min_length=1, max_length=255),
    x_allowed_roles: str | None = Header(default=None),
    x_allowed_users: str | None = Header(default=None),
) -> IngestResponse:
    require_admin(principal)
    document_name = validate_document_name(x_document_name)
    content = await read_limited_body(request)
    if not content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document cannot be empty")
    content_sha256 = sha256(content).hexdigest()
    if await document_exists(session, principal.tenant_id, content_sha256):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This document version is already indexed")
    content_type = request.headers.get("content-type", "")
    text = extract_text(content, content_type)
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document has no extractable text")
    if len(chunks) > get_settings().max_document_chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document exceeds configured chunk limit")
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)
    document_id = str(uuid4())
    embeddings = await ollama.embed(chunks)
    await vectors.upsert_document(principal.tenant_id, document_id, document_name, chunks, embeddings, allowed_roles, allowed_users)
    try:
        session.add(DocumentRecord(document_id=document_id, tenant_id=principal.tenant_id, document_name=document_name, content_type=content_type, content_sha256=content_sha256, size_bytes=len(content), chunk_count=len(chunks), allowed_roles=allowed_roles, allowed_users=allowed_users, created_by=principal.user_id))
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        await vectors.delete_document(principal.tenant_id, document_id)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This document version is already indexed") from error
    await record(session, "document_ingested", principal.tenant_id, principal.user_id, document_id=document_id, chunks=len(chunks))
    return IngestResponse(document_id=document_id, chunks_indexed=len(chunks))


@app.delete("/v1/documents/{document_id}", response_model=DeleteResponse)
async def delete_document(
    document_id: str,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> DeleteResponse:
    require_admin(principal)
    document = await get_document(session, principal.tenant_id, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    await vectors.delete_document(principal.tenant_id, document_id)
    await mark_document_deleted(session, document)
    await record(session, "document_deleted", principal.tenant_id, principal.user_id, document_id=document_id)
    return DeleteResponse(document_id=document_id, status="deleted")


@app.post("/v1/query", response_model=QueryResponse)
async def query_documents(
    payload: QueryRequest,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> QueryResponse:
    embedding = (await ollama.embed([payload.question]))[0]
    matches = await vectors.search(principal, embedding, payload.top_k)
    if not matches:
        await record(session, "query_completed", principal.tenant_id, principal.user_id, result_count=0)
        return QueryResponse(answer="I do not have enough information in the documents you are allowed to access.", citations=[])
    context_parts: list[str] = []
    context_size = 0
    for index, match in enumerate(matches, start=1):
        source = f"[Source {index}] {match.payload['text']}"
        if context_size + len(source) > get_settings().max_context_characters:
            break
        context_parts.append(source)
        context_size += len(source)
    answer = await ollama.answer(payload.question, "\n\n".join(context_parts))
    citations = [Citation(document_id=match.payload["document_id"], document_name=match.payload["document_name"], chunk_index=match.payload["chunk_index"], score=round(match.score, 4)) for match in matches[:len(context_parts)]]
    await record(session, "query_completed", principal.tenant_id, principal.user_id, result_count=len(citations))
    return QueryResponse(answer=answer, citations=citations)
