import asyncio
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
from .document_parser import VisualAsset, extract_document
from .mineru import MinerUClient, supports_mineru
from .models import ChatDetail, ChatMessage, ChatSummary, DeleteResponse, IngestResponse, Principal, QueryRequest, QueryResponse, ReadinessResponse
from .providers import ModelClient
from .repository import add_chat_message, create_chat, database_is_ready, get_chat, get_document, get_document_by_content_hash, list_chat_messages, list_chats, mark_document_deleted
from .vector_store import VectorStore

model_server = ModelClient()
mineru = MinerUClient()
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


def existing_document_event(document: DocumentRecord) -> dict[str, object]:
    return {
        "type": "complete",
        "percentage": 100,
        "document_id": document.document_id,
        "chunks_indexed": document.chunk_count,
        "tables_indexed": 0,
        "visuals_indexed": 0,
        "reindexed": False,
        "message": "Document is searchable",
    }


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
    existing_document: DocumentRecord | None = None,
):
    settings = get_settings()
    yield {"type": "progress", "percentage": 5, "stage": "extracting", "message": "Extracting text, tables, and visual content"}
    if settings.mineru_enabled and supports_mineru(content_type):
        parse_task = asyncio.create_task(mineru.parse(content, content_type, document_name, settings.max_visuals_per_document))
        parsing_percentage = 5
        try:
            while not parse_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(parse_task), timeout=2)
                except TimeoutError:
                    parsing_percentage = min(24, parsing_percentage + 1)
                    yield {
                        "type": "progress",
                        "percentage": parsing_percentage,
                        "stage": "extracting",
                        "message": "MinerU is extracting document content",
                    }
            parsed = await parse_task
        finally:
            if not parse_task.done():
                parse_task.cancel()
                await asyncio.gather(parse_task, return_exceptions=True)
    else:
        parsed = extract_document(content, content_type, settings.max_visuals_per_document)
    text_sections = [parsed.text] if parsed.text.strip() else []
    visuals_indexed = parsed.described_visual_count
    if parsed.visuals:
        semaphore = asyncio.Semaphore(settings.visual_analysis_concurrency)

        async def describe_visual(visual_index: int):
            visual = parsed.visuals[visual_index]
            async with semaphore:
                description = await model_server.describe_visual(visual)
            return visual_index, visual, description

        tasks = [asyncio.create_task(describe_visual(index)) for index in range(len(parsed.visuals))]
        descriptions: dict[int, tuple[VisualAsset, str]] = {}
        try:
            for completed_count, completed_task in enumerate(asyncio.as_completed(tasks), start=1):
                visual_index, visual, description = await completed_task
                descriptions[visual_index] = (visual, description)
                percentage = 5 + round((completed_count / len(tasks)) * 20)
                yield {
                    "type": "progress",
                    "percentage": percentage,
                    "stage": "visual_analysis",
                    "message": f"Analyzed {completed_count} of {len(tasks)} visuals",
                }
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

        for visual_index in sorted(descriptions):
            visual, description = descriptions[visual_index]
            if description != "NO_MEANINGFUL_VISUAL":
                text_sections.append(f"[Visual content: {visual.location}]\n{description}")
                if not visual.description_indexed:
                    visuals_indexed += 1

    chunks = chunk_text("\n\n".join(text_sections))
    if not chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document has no indexable text, tables, or visuals")
    if len(chunks) > settings.max_document_chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document exceeds configured chunk limit")

    yield {"type": "progress", "percentage": 28, "stage": "chunking", "message": f"Prepared {len(chunks)} searchable chunks"}
    embeddings: list[list[float]] = []
    async for completed, total, batch_embeddings in model_server.embed_batches(chunks):
        embeddings.extend(batch_embeddings)
        percentage = 28 + round((completed / total) * 57)
        yield {
            "type": "progress",
            "percentage": percentage,
            "stage": "embedding",
            "message": f"Embedded {completed} of {total} chunks",
        }

    document_id = existing_document.document_id if existing_document is not None else str(uuid4())
    yield {"type": "progress", "percentage": 90, "stage": "vector_storage", "message": "Saving searchable vectors"}
    if existing_document is not None:
        await vectors.delete_document(principal.tenant_id, document_id)
    await vectors.upsert_document(principal.tenant_id, document_id, document_name, chunks, embeddings, allowed_roles, allowed_users)
    yield {"type": "progress", "percentage": 96, "stage": "metadata", "message": "Saving document metadata"}
    try:
        if existing_document is None:
            session.add(DocumentRecord(document_id=document_id, tenant_id=principal.tenant_id, document_name=document_name, content_type=content_type, content_sha256=content_sha256, size_bytes=len(content), chunk_count=len(chunks), allowed_roles=allowed_roles, allowed_users=allowed_users, created_by=principal.user_id))
        else:
            existing_document.document_name = document_name
            existing_document.content_type = content_type
            existing_document.size_bytes = len(content)
            existing_document.chunk_count = len(chunks)
            existing_document.allowed_roles = allowed_roles
            existing_document.allowed_users = allowed_users
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        await vectors.delete_document(principal.tenant_id, document_id)
        existing_document = await get_document_by_content_hash(session, principal.tenant_id, content_sha256)
        if existing_document is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Document indexing conflicted with another request") from error
        yield existing_document_event(existing_document)
        return
    await record(
        session,
        "document_reindexed" if existing_document is not None else "document_ingested",
        principal.tenant_id,
        principal.user_id,
        document_id=document_id,
        chunks=len(chunks),
        tables=parsed.table_count,
        visuals=visuals_indexed,
    )
    yield {
        "type": "complete",
        "percentage": 100,
        "document_id": document_id,
        "chunks_indexed": len(chunks),
        "tables_indexed": parsed.table_count,
        "visuals_indexed": visuals_indexed,
        "reindexed": existing_document is not None,
        "message": "Document was re-indexed" if existing_document is not None else "Document is searchable",
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
    if get_settings().mineru_enabled:
        components["mineru"] = "ready" if await mineru.is_ready() else "unavailable"
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
    existing_document = await get_document_by_content_hash(session, principal.tenant_id, content_sha256)
    content_type = request.headers.get("content-type", "")
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)
    completed: dict[str, object] | None = None
    async for event in index_document_events(content, content_type, content_sha256, document_name, allowed_roles, allowed_users, principal, session, existing_document):
        if event["type"] == "complete":
            completed = event
    if completed is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Document indexing did not complete")
    return IngestResponse(
        document_id=str(completed["document_id"]),
        chunks_indexed=int(completed["chunks_indexed"]),
        tables_indexed=int(completed["tables_indexed"]),
        visuals_indexed=int(completed["visuals_indexed"]),
    )


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
    existing_document = await get_document_by_content_hash(session, principal.tenant_id, content_sha256)
    content_type = request.headers.get("content-type", "")
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)

    async def events():
        try:
            async for event in index_document_events(content, content_type, content_sha256, document_name, allowed_roles, allowed_users, principal, session, existing_document):
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
