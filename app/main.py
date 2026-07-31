from contextlib import asynccontextmanager
from hashlib import sha256
import json
from pathlib import PurePath
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import record
from .auth import require_admin, require_principal
from .chunking import chunk_text
from .config import get_settings
from .database import DocumentRecord, dispose_database, get_session, initialize_database
from .document_parser import extract_text
from .models import ChatDetail, ChatMessage, ChatSummary, DeleteResponse, IngestResponse, Principal, QueryRequest, QueryResponse, ReadinessResponse
from .providers import ModelClient
from .repository import add_chat_message, create_chat, database_is_ready, document_exists, get_chat, get_document, list_chat_messages, list_chats, mark_document_deleted
from .vector_store import VectorStore

model_server = ModelClient()
vectors = VectorStore()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await initialize_database()
    yield
    await vectors.close()
    await dispose_database()


app = FastAPI(title="Secure Document RAG", version="0.2.0", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=get_settings().allowed_host_list)
app.mount("/assets", StaticFiles(directory="app/static"), name="assets")


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


def encode_event(event: dict[str, object]) -> str:
    return json.dumps(event) + "\n"


def chat_title(question: str) -> str:
    normalized = " ".join(question.split())
    return normalized[:77] + "..." if len(normalized) > 80 else normalized


async def resolve_chat(payload: QueryRequest, principal: Principal, session: AsyncSession):
    if payload.chat_id:
        chat = await get_chat(session, principal.tenant_id, principal.user_id, payload.chat_id)
        if chat is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    else:
        chat = await create_chat(session, principal.tenant_id, principal.user_id, chat_title(payload.question))
    await add_chat_message(session, chat, "user", payload.question)
    return chat


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


async def index_document_events(
    content: bytes,
    content_type: str,
    content_sha256: str,
    document_name: str,
    allowed_roles: list[str],
    allowed_users: list[str],
    principal: Principal,
    session: AsyncSession,
):
    yield {"type": "progress", "percentage": 5, "stage": "extracting", "message": "Extracting document text"}
    text = extract_text(content, content_type)
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document has no extractable text")
    if len(chunks) > get_settings().max_document_chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document exceeds configured chunk limit")

    yield {"type": "progress", "percentage": 15, "stage": "chunking", "message": f"Prepared {len(chunks)} searchable chunks"}
    embeddings: list[list[float]] = []
    async for completed, total, batch_embeddings in model_server.embed_batches(chunks):
        embeddings.extend(batch_embeddings)
        percentage = 15 + round((completed / total) * 70)
        yield {
            "type": "progress",
            "percentage": percentage,
            "stage": "embedding",
            "message": f"Embedded {completed} of {total} chunks",
        }

    document_id = str(uuid4())
    yield {"type": "progress", "percentage": 90, "stage": "vector_storage", "message": "Saving searchable vectors"}
    await vectors.upsert_document(principal.tenant_id, document_id, document_name, chunks, embeddings, allowed_roles, allowed_users)
    yield {"type": "progress", "percentage": 96, "stage": "metadata", "message": "Saving document metadata"}
    try:
        session.add(DocumentRecord(document_id=document_id, tenant_id=principal.tenant_id, document_name=document_name, content_type=content_type, content_sha256=content_sha256, size_bytes=len(content), chunk_count=len(chunks), allowed_roles=allowed_roles, allowed_users=allowed_users, created_by=principal.user_id))
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        await vectors.delete_document(principal.tenant_id, document_id)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This document version is already indexed") from error
    await record(session, "document_ingested", principal.tenant_id, principal.user_id, document_id=document_id, chunks=len(chunks))
    yield {
        "type": "complete",
        "percentage": 100,
        "document_id": document_id,
        "chunks_indexed": len(chunks),
        "message": "Document is searchable",
    }


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def chat_ui() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/readyz", response_model=ReadinessResponse)
async def readyz(session: AsyncSession = Depends(get_session)) -> ReadinessResponse:
    components = {
        "database": "ready" if await database_is_ready(session) else "unavailable",
        "qdrant": "ready" if await vectors.is_ready() else "unavailable",
        "model_server": "ready" if await model_server.is_ready() else "unavailable",
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
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)
    completed: dict[str, object] | None = None
    async for event in index_document_events(content, content_type, content_sha256, document_name, allowed_roles, allowed_users, principal, session):
        if event["type"] == "complete":
            completed = event
    if completed is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Document indexing did not complete")
    return IngestResponse(document_id=str(completed["document_id"]), chunks_indexed=int(completed["chunks_indexed"]))


@app.post("/v1/documents/stream")
async def stream_ingest_document(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
    x_document_name: str = Header(min_length=1, max_length=255),
    x_allowed_roles: str | None = Header(default=None),
    x_allowed_users: str | None = Header(default=None),
) -> StreamingResponse:
    require_admin(principal)
    document_name = validate_document_name(x_document_name)
    content = await read_limited_body(request)
    if not content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document cannot be empty")
    content_sha256 = sha256(content).hexdigest()
    if await document_exists(session, principal.tenant_id, content_sha256):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This document version is already indexed")
    content_type = request.headers.get("content-type", "")
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)

    async def events():
        try:
            async for event in index_document_events(content, content_type, content_sha256, document_name, allowed_roles, allowed_users, principal, session):
                yield encode_event(event)
        except HTTPException as error:
            yield encode_event({"type": "error", "detail": error.detail})

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})


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


@app.get("/v1/chats", response_model=list[ChatSummary])
async def get_chat_history(
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> list[ChatSummary]:
    chats = await list_chats(session, principal.tenant_id, principal.user_id)
    return [ChatSummary.model_validate(chat, from_attributes=True) for chat in chats]


@app.get("/v1/chats/{chat_id}", response_model=ChatDetail)
async def get_chat_history_detail(
    chat_id: str,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> ChatDetail:
    chat = await get_chat(session, principal.tenant_id, principal.user_id, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    messages = await list_chat_messages(session, chat.chat_id)
    return ChatDetail(
        **ChatSummary.model_validate(chat, from_attributes=True).model_dump(),
        messages=[ChatMessage.model_validate(message, from_attributes=True) for message in messages],
    )


@app.post("/v1/query", response_model=QueryResponse)
async def query_documents(
    payload: QueryRequest,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> QueryResponse:
    chat = await resolve_chat(payload, principal, session)
    embedding = (await model_server.embed([payload.question]))[0]
    matches = await vectors.search(principal, embedding, payload.top_k)
    if not matches:
        await record(session, "query_completed", principal.tenant_id, principal.user_id, result_count=0)
        answer = "I do not have enough information in the documents you are allowed to access."
        await add_chat_message(session, chat, "assistant", answer)
        return QueryResponse(answer=answer, chat_id=chat.chat_id)
    context_parts: list[str] = []
    context_size = 0
    for index, match in enumerate(matches, start=1):
        source = f"[Source {index}] {match.payload['text']}"
        if context_size + len(source) > get_settings().max_context_characters:
            break
        context_parts.append(source)
        context_size += len(source)
    answer = await model_server.answer(payload.question, "\n\n".join(context_parts))
    await add_chat_message(session, chat, "assistant", answer)
    await record(session, "query_completed", principal.tenant_id, principal.user_id, result_count=len(context_parts))
    return QueryResponse(answer=answer, chat_id=chat.chat_id)


@app.post("/v1/query/stream")
async def stream_query_documents(
    payload: QueryRequest,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    chat = await resolve_chat(payload, principal, session)
    embedding = (await model_server.embed([payload.question]))[0]
    matches = await vectors.search(principal, embedding, payload.top_k)
    context_parts: list[str] = []
    context_size = 0
    for index, match in enumerate(matches, start=1):
        source = f"[Source {index}] {match.payload['text']}"
        if context_size + len(source) > get_settings().max_context_characters:
            break
        context_parts.append(source)
        context_size += len(source)

    async def events():
        yield encode_event({"type": "chat", "chat_id": chat.chat_id, "title": chat.title})
        if not context_parts:
            answer = "I do not have enough information in the documents you are allowed to access."
            yield encode_event({"type": "delta", "text": answer})
            await add_chat_message(session, chat, "assistant", answer)
            await record(session, "query_completed", principal.tenant_id, principal.user_id, result_count=0)
            yield encode_event({"type": "done"})
            return
        try:
            answer_parts: list[str] = []
            async for content in model_server.answer_stream(payload.question, "\n\n".join(context_parts)):
                answer_parts.append(content)
                yield encode_event({"type": "delta", "text": content})
            answer = "".join(answer_parts).strip()
            if answer:
                await add_chat_message(session, chat, "assistant", answer)
            await record(
                session,
                "query_completed",
                principal.tenant_id,
                principal.user_id,
                result_count=len(context_parts),
            )
            yield encode_event({"type": "done"})
        except HTTPException as error:
            yield encode_event({"type": "error", "detail": error.detail})

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},
    )
