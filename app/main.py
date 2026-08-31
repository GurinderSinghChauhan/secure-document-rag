import asyncio
from contextlib import asynccontextmanager
from hashlib import sha256
import json
from pathlib import PurePath
from time import monotonic
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import record
from .accounts import router as accounts_router
from .auth import require_admin, require_principal
from .chunking import chunk_text
from .config import get_settings
from .compute import assert_release_within_limits, recommended_gpu_minutes
from .database import ComputeSessionRecord, DocumentRecord, IngestionJobRecord, SessionFactory, dispose_database, get_session, initialize_database
from .document_parser import VisualAsset, extract_document
from .document_schemas import DOCUMENT_SCHEMAS, INDUSTRIES, SCHEMA_VERSION, require_document_schema, schema_catalog
from .mineru import MinerUClient, supports_mineru
from .models import BulkDeleteResponse, ChatDetail, ChatMessage, ChatSummary, ComputeSessionCreate, ComputeSessionRelease, ComputeSessionResponse, DashboardDocumentListResponse, DashboardDocumentResponse, DashboardIndustryResponse, DashboardResponse, DeleteResponse, HeldIngestResponse, IndexedDocumentResponse, IndustrySchemaResponse, IngestionJobResponse, Principal, QueryRequest, QueryResponse, ReadinessResponse, VersionResponse
from .providers import ModelClient
from .super_admin import router as super_admin_router
from .trials import is_pdf, require_active_trial, reserve_pdf_trial_slot, reserve_question_trial_slot
from .repository import add_chat_message, create_chat, database_is_ready, get_chat, get_document, get_document_by_content_hash, list_authorized_documents, list_chat_messages, list_chats, list_documents, mark_document_deleted, mark_documents_deleted, search_authorized_documents
from .vector_store import VectorStore
from .version import APP_COMMIT, APP_VERSION

model_server = ModelClient()
mineru = MinerUClient()
vectors = VectorStore()
compute_tasks: dict[str, asyncio.Task[None]] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    await initialize_database()
    # A control-plane restart never wakes compute. Interrupted local work becomes
    # safely retryable and must be released by an administrator again.
    async with SessionFactory() as session:
        await session.execute(
            update(IngestionJobRecord)
            .where(IngestionJobRecord.state.in_(["provider_queued", "cold_start", "processing", "retrying"]))
            .values(state="held_for_compute", stage="held", progress=0, message="Processing was interrupted; document is safely held for retry.")
        )
        await session.execute(
            update(ComputeSessionRecord)
            .where(ComputeSessionRecord.status.in_(["open", "draining"]))
            .values(status="closed", closed_at=func.now())
        )
        await session.commit()
    yield
    await vectors.close()
    await dispose_database()


app = FastAPI(title="Secure Document RAG", version=APP_VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)
app.include_router(accounts_router)
app.include_router(super_admin_router)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=get_settings().allowed_host_list)
app.mount("/assets", StaticFiles(directory="app/static"), name="assets")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = (
        "public, max-age=31536000, immutable"
        if request.url.path.startswith("/assets/spa/assets/")
        else "no-store"
    )
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


def validate_document_type(document_type: str | None) -> str | None:
    try:
        schema = require_document_schema(document_type)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error)) from error
    return schema.key if schema else None


def document_is_authorized(document: DocumentRecord, principal: Principal) -> bool:
    return bool(set(document.allowed_roles).intersection(principal.roles)) or principal.user_id in document.allowed_users


def classification_decision(
    candidate: str,
    confidence: float,
    auto_accept_threshold: float,
    review_threshold: float,
) -> tuple[str | None, str]:
    if confidence >= auto_accept_threshold:
        return candidate, "confirmed"
    if confidence >= review_threshold:
        return candidate, "review_required"
    return None, "unclassified"


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


def job_response(job: IngestionJobRecord) -> IngestionJobResponse:
    values = {column.name: getattr(job, column.name) for column in IngestionJobRecord.__table__.columns}
    values["recommended_gpu_minutes"] = recommended_gpu_minutes(job.content_type, job.size_bytes)
    return IngestionJobResponse.model_validate(values)


def indexed_document_response(document: DocumentRecord) -> IndexedDocumentResponse:
    values = {column.name: getattr(document, column.name) for column in DocumentRecord.__table__.columns}
    values["schema_version"] = values.get("schema_version") or SCHEMA_VERSION
    values["classification_status"] = values.get("classification_status") or "unclassified"
    values["classification_source"] = values.get("classification_source") or "automatic"
    values["extraction_status"] = values.get("extraction_status") or "not_requested"
    values["extracted_metadata"] = values.get("extracted_metadata") or {}
    return IndexedDocumentResponse.model_validate(values)


async def create_held_job(
    *, session: AsyncSession, principal: Principal, document_name: str, content: bytes,
    content_type: str, allowed_roles: list[str], allowed_users: list[str], document_type: str | None = None,
) -> IngestionJobRecord:
    job = IngestionJobRecord(
        job_id=str(uuid4()), tenant_id=principal.tenant_id, state="held_for_compute", stage="held", progress=0,
        message="GPU processing is off; document saved and waiting.", document_name=document_name,
        document_type=document_type,
        content_type=content_type, content_sha256=sha256(content).hexdigest(), content=content, size_bytes=len(content),
        allowed_roles=allowed_roles, allowed_users=allowed_users, created_by=principal.user_id,
        retry_limit=get_settings().compute_retry_limit,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    await record(session, "document_held_for_compute", principal.tenant_id, principal.user_id, job_id=job.job_id, document_name=document_name)
    return job


async def get_open_compute_session(session: AsyncSession, tenant_id: str) -> ComputeSessionRecord | None:
    return await session.scalar(
        select(ComputeSessionRecord).where(ComputeSessionRecord.tenant_id == tenant_id, ComputeSessionRecord.status == "open")
    )


def require_compute_for_query() -> None:
    settings = get_settings()
    if not settings.gpu_dispatch_enabled:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GPU processing is off; an administrator must enable dispatch before chatting.")
    if settings.compute_provider != "local_docker":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Interactive queries are not enabled for this asynchronous compute provider.")


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
    await reserve_question_trial_slot(session, principal)
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
    document_type: str | None = None,
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

    index_text = "\n\n".join(text_sections)
    chunks = chunk_text(index_text)
    if not chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document has no indexable text, tables, or visuals")
    if len(chunks) > settings.max_document_chunks:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document exceeds configured chunk limit")

    resolved_document_type = document_type
    classification_status = "confirmed" if document_type else "unclassified"
    classification_source = "manual" if document_type else "automatic"
    classification_confidence: float | None = None
    if document_type is None:
        yield {
            "type": "progress",
            "percentage": 25,
            "stage": "classification",
            "message": "Detecting document type",
        }
        try:
            candidate, confidence = await model_server.classify_document(
                tuple(
                    (key, schema.label)
                    for key, (_, schema) in DOCUMENT_SCHEMAS.items()
                ),
                index_text,
            )
            classification_confidence = confidence
            auto_accept_threshold = getattr(
                settings,
                "classification_auto_accept_threshold",
                0.85,
            )
            review_threshold = getattr(
                settings,
                "classification_review_threshold",
                0.60,
            )
            resolved_document_type, classification_status = classification_decision(
                candidate,
                confidence,
                auto_accept_threshold,
                review_threshold,
            )
        except HTTPException:
            classification_status = "failed"

    extracted_metadata: dict[str, object] = {}
    extraction_status = "not_requested"
    schema = require_document_schema(resolved_document_type)
    if schema is not None:
        yield {"type": "progress", "percentage": 26, "stage": "metadata_extraction", "message": f"Extracting {schema.label} fields"}
        try:
            extracted_metadata = await model_server.extract_metadata(schema.label, schema.fields, index_text)
            extraction_status = "completed"
        except HTTPException:
            extraction_status = "failed"

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

    was_deleted = existing_document is not None and existing_document.deleted_at is not None
    document_id = existing_document.document_id if existing_document is not None else str(uuid4())
    yield {"type": "progress", "percentage": 90, "stage": "vector_storage", "message": "Saving searchable vectors"}
    if existing_document is not None:
        await vectors.delete_document(principal.tenant_id, document_id)
    await vectors.upsert_document(principal.tenant_id, document_id, document_name, chunks, embeddings, allowed_roles, allowed_users)
    yield {"type": "progress", "percentage": 96, "stage": "metadata", "message": "Saving document metadata"}
    try:
        if existing_document is None:
            session.add(DocumentRecord(document_id=document_id, tenant_id=principal.tenant_id, document_name=document_name, document_type=resolved_document_type, schema_version=SCHEMA_VERSION, classification_status=classification_status, classification_source=classification_source, classification_confidence=classification_confidence, extraction_status=extraction_status, extracted_metadata=extracted_metadata, content_type=content_type, content_sha256=content_sha256, size_bytes=len(content), chunk_count=len(chunks), allowed_roles=allowed_roles, allowed_users=allowed_users, created_by=principal.user_id))
        else:
            existing_document.document_name = document_name
            existing_document.document_type = resolved_document_type
            existing_document.schema_version = SCHEMA_VERSION
            existing_document.classification_status = classification_status
            existing_document.classification_source = classification_source
            existing_document.classification_confidence = classification_confidence
            existing_document.extraction_status = extraction_status
            existing_document.extracted_metadata = extracted_metadata
            existing_document.content_type = content_type
            existing_document.size_bytes = len(content)
            existing_document.chunk_count = len(chunks)
            existing_document.allowed_roles = allowed_roles
            existing_document.allowed_users = allowed_users
            existing_document.deleted_at = None
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
        "document_restored" if was_deleted else "document_reindexed" if existing_document is not None else "document_ingested",
        principal.tenant_id,
        principal.user_id,
        document_id=document_id,
        chunks=len(chunks),
        tables=parsed.table_count,
        visuals=visuals_indexed,
        document_type=resolved_document_type,
        classification_status=classification_status,
        classification_source=classification_source,
        classification_confidence=classification_confidence,
    )
    yield {
        "type": "complete",
        "percentage": 100,
        "document_id": document_id,
        "chunks_indexed": len(chunks),
        "tables_indexed": parsed.table_count,
        "visuals_indexed": visuals_indexed,
        "reindexed": existing_document is not None,
        "message": "Document was restored and re-indexed" if was_deleted else "Document was re-indexed" if existing_document is not None else "Document is searchable",
    }


async def run_local_compute_session(compute_session_id: str, job_ids: list[str]) -> None:
    """Runs one heavy operation at a time after an explicit admin release."""
    settings = get_settings()
    for job_id in job_ids:
        started = monotonic()
        async with SessionFactory() as session:
            compute_session = await session.get(ComputeSessionRecord, compute_session_id)
            job = await session.get(IngestionJobRecord, job_id)
            if compute_session is None or job is None or compute_session.status not in {"open", "draining"}:
                continue
            if compute_session.gpu_seconds >= compute_session.max_gpu_minutes * 60:
                job.state, job.stage, job.progress = "held_for_compute", "held", 0
                job.message = "Session GPU time limit reached; document returned to held state."
                await session.commit()
                break
            if compute_session.max_estimated_cost_usd is not None and compute_session.estimated_cost_usd >= compute_session.max_estimated_cost_usd:
                job.state, job.stage, job.progress = "held_for_compute", "held", 0
                job.message = "Session cost limit reached; document returned to held state."
                await session.commit()
                break
            job.state, job.stage, job.progress = "processing", "cold_start", 1
            job.message = "Compute available; starting document worker."
            attempt_count = job.attempt_count + 1
            job.attempt_count = attempt_count
            await session.commit()
            principal = Principal(tenant_id=job.tenant_id, user_id=job.created_by, roles=job.allowed_roles)
            existing = await get_document_by_content_hash(session, job.tenant_id, job.content_sha256, include_deleted=True)
            try:
                async for event in index_document_events(job.content, job.content_type, job.content_sha256, job.document_name, job.allowed_roles, job.allowed_users, principal, session, existing, job.document_type):
                    elapsed = monotonic() - started
                    if compute_session.gpu_seconds + elapsed >= compute_session.max_gpu_minutes * 60:
                        raise TimeoutError("Compute session GPU time limit reached")
                    job.stage = str(event.get("stage", "completion"))
                    job.progress = int(event.get("percentage", job.progress))
                    job.message = str(event.get("message", job.message))[:500]
                    if event.get("type") == "complete":
                        job.state = "completed"
                        job.result_document_id = str(event["document_id"])
                        job.chunks_indexed = int(event["chunks_indexed"])
                        job.tables_indexed = int(event["tables_indexed"])
                        job.visuals_indexed = int(event["visuals_indexed"])
                    await session.commit()
            except asyncio.CancelledError:
                await session.rollback()
                await session.execute(
                    update(IngestionJobRecord)
                    .where(IngestionJobRecord.job_id == job_id)
                    .values(
                        state="held_for_compute",
                        stage="held",
                        progress=0,
                        message="Session cancelled; document returned to held state.",
                    )
                )
                await session.commit()
                raise
            except Exception as error:
                await session.rollback()
                retry_limit = await session.scalar(
                    select(IngestionJobRecord.retry_limit).where(IngestionJobRecord.job_id == job_id)
                )
                exhausted = retry_limit is None or attempt_count >= retry_limit
                is_oom = "out of memory" in str(error).lower() or "oom" in str(error).lower()
                await session.execute(
                    update(IngestionJobRecord)
                    .where(IngestionJobRecord.job_id == job_id)
                    .values(
                        state="failed" if exhausted else "held_for_compute",
                        stage="failed" if exhausted else "held",
                        progress=0,
                        error_code="gpu_out_of_memory" if is_oom else "processing_failed",
                        error_message=str(error)[:500],
                        message="Retry limit exhausted." if exhausted else "Processing failed; document returned to held state for retry.",
                    )
                )
                await session.commit()
            finally:
                elapsed = monotonic() - started
                await session.execute(
                    update(IngestionJobRecord)
                    .where(IngestionJobRecord.job_id == job_id)
                    .values(
                        gpu_seconds=IngestionJobRecord.gpu_seconds + elapsed,
                        estimated_cost_usd=(IngestionJobRecord.gpu_seconds + elapsed) * settings.compute_gpu_hourly_cost_usd / 3600,
                    )
                )
                await session.execute(
                    update(ComputeSessionRecord)
                    .where(ComputeSessionRecord.session_id == compute_session_id)
                    .values(
                        gpu_seconds=ComputeSessionRecord.gpu_seconds + elapsed,
                        estimated_cost_usd=(ComputeSessionRecord.gpu_seconds + elapsed) * settings.compute_gpu_hourly_cost_usd / 3600,
                    )
                )
                await session.commit()

    async with SessionFactory() as session:
        compute_session = await session.get(ComputeSessionRecord, compute_session_id)
        if compute_session is not None:
            await session.execute(
                update(IngestionJobRecord).where(
                    IngestionJobRecord.compute_session_id == compute_session_id,
                    IngestionJobRecord.state == "provider_queued",
                ).values(state="held_for_compute", stage="held", progress=0, message="Session stopped before dispatch; document remains held.")
            )
            remaining = await session.scalar(
                select(func.count()).select_from(IngestionJobRecord).where(
                    IngestionJobRecord.compute_session_id == compute_session_id,
                    IngestionJobRecord.state.in_(["provider_queued", "cold_start", "processing", "retrying"]),
                )
            )
            if not remaining:
                compute_session.status = "closed"
                compute_session.closed_at = func.now()
                await session.commit()
    compute_tasks.pop(compute_session_id, None)


async def compute_session_payload(session: AsyncSession, record_: ComputeSessionRecord) -> ComputeSessionResponse:
    jobs = list(await session.scalars(select(IngestionJobRecord).where(IngestionJobRecord.compute_session_id == record_.session_id).order_by(IngestionJobRecord.created_at)))
    return ComputeSessionResponse(
        session_id=record_.session_id, status=record_.status, provider=record_.provider,
        max_jobs=record_.max_jobs, max_gpu_minutes=record_.max_gpu_minutes,
        max_estimated_cost_usd=record_.max_estimated_cost_usd, released_job_count=record_.released_job_count,
        gpu_seconds=record_.gpu_seconds, estimated_cost_usd=record_.estimated_cost_usd,
        jobs=[job_response(job) for job in jobs],
    )


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/version", response_model=VersionResponse)
async def version() -> VersionResponse:
    return VersionResponse(version=APP_VERSION, commit=APP_COMMIT)


@app.get("/", include_in_schema=False)
async def chat_ui() -> FileResponse:
    return FileResponse("app/static/spa/index.html")


@app.get("/ask", include_in_schema=False)
async def ask_ui() -> FileResponse:
    return FileResponse("app/static/spa/index.html")


@app.get("/insights/{document_type}", include_in_schema=False)
async def insights_ui(document_type: str) -> FileResponse:
    del document_type
    return FileResponse("app/static/spa/index.html")


@app.get("/admin", include_in_schema=False)
async def admin_ui() -> FileResponse:
    return FileResponse("app/static/spa/index.html")


@app.get("/super-admin", include_in_schema=False)
async def super_admin_ui() -> FileResponse:
    return FileResponse("app/static/spa/index.html")


@app.get("/readyz", response_model=ReadinessResponse)
async def readyz(session: AsyncSession = Depends(get_session)) -> ReadinessResponse:
    # Readiness is intentionally control-plane only. It must never wake or poll
    # GPU compute, model servers, MinerU, or a hosted provider.
    components = {
        "database": "ready" if await database_is_ready(session) else "unavailable",
        "qdrant": "ready" if await vectors.is_ready() else "unavailable",
    }
    components["compute"] = "enabled_idle" if get_settings().gpu_dispatch_enabled else "disabled"
    if components["database"] != "ready" or components["qdrant"] != "ready":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"status": "unavailable", "components": components})
    return ReadinessResponse(status="ready", components=components)


@app.get("/v1/document-schemas", response_model=list[IndustrySchemaResponse])
async def list_document_schemas(_: Principal = Depends(require_principal)) -> list[dict[str, object]]:
    return schema_catalog()


def dashboard_document_response(document: DocumentRecord) -> DashboardDocumentResponse:
    match = DOCUMENT_SCHEMAS.get(document.document_type or "")
    if match:
        industry, document_schema = match
        document_type_label = document_schema.label
        industry_key = industry.key
        industry_label = industry.label
    else:
        document_type_label = "Unclassified"
        industry_key = None
        industry_label = "Needs classification"
    return DashboardDocumentResponse(
        document_id=document.document_id,
        document_name=document.document_name,
        document_type=document.document_type,
        document_type_label=document_type_label,
        industry_key=industry_key,
        industry_label=industry_label,
        classification_status=document.classification_status or "unclassified",
        classification_source=document.classification_source or "automatic",
        classification_confidence=document.classification_confidence,
        extraction_status=document.extraction_status or "not_requested",
        extracted_metadata=document.extracted_metadata or {},
        created_at=document.created_at,
    )


@app.get("/v1/dashboard", response_model=DashboardResponse)
async def dashboard(
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> DashboardResponse:
    documents = [
        document
        for document in await list_authorized_documents(
            session,
            principal.tenant_id,
            principal.roles,
            principal.user_id,
        )
        if document_is_authorized(document, principal)
    ]
    industry_counts = {industry.key: 0 for industry in INDUSTRIES}
    recent_documents: list[DashboardDocumentResponse] = []
    classified_documents = 0
    extracted_documents = 0
    review_required_documents = 0
    for document in documents:
        match = DOCUMENT_SCHEMAS.get(document.document_type or "")
        if match:
            industry, _ = match
            industry_counts[industry.key] += 1
            classified_documents += 1
        extraction_status = document.extraction_status or "not_requested"
        classification_status = document.classification_status or "unclassified"
        if classification_status == "review_required":
            review_required_documents += 1
        if extraction_status == "completed":
            extracted_documents += 1
        if len(recent_documents) < 20:
            recent_documents.append(dashboard_document_response(document))
    return DashboardResponse(
        total_documents=len(documents),
        classified_documents=classified_documents,
        extracted_documents=extracted_documents,
        review_required_documents=review_required_documents,
        industries=[
            DashboardIndustryResponse(
                key=industry.key,
                label=industry.label,
                document_count=industry_counts[industry.key],
                document_type_count=len(industry.document_types),
            )
            for industry in INDUSTRIES
        ],
        recent_documents=recent_documents,
    )


@app.get("/v1/dashboard/documents", response_model=DashboardDocumentListResponse)
async def dashboard_documents(
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
    query: str = Query(default="", max_length=100),
    limit: int = Query(default=100, ge=1, le=100),
) -> DashboardDocumentListResponse:
    normalized_query = query.strip()
    lowered_query = normalized_query.lower()
    matching_type_keys = (
        [
            key
            for key, (industry, document_schema) in DOCUMENT_SCHEMAS.items()
            if lowered_query in document_schema.label.lower()
            or lowered_query in industry.label.lower()
            or lowered_query in key.lower()
        ]
        if normalized_query
        else []
    )
    documents, total = await search_authorized_documents(
        session,
        principal.tenant_id,
        principal.roles,
        principal.user_id,
        normalized_query,
        matching_type_keys,
        limit,
    )
    authorized_documents = [
        document
        for document in documents
        if document_is_authorized(document, principal)
    ]
    return DashboardDocumentListResponse(
        total=total,
        documents=[dashboard_document_response(document) for document in authorized_documents],
    )


@app.post("/v1/documents", response_model=HeldIngestResponse, status_code=status.HTTP_202_ACCEPTED)
async def ingest_document(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
    x_document_name: str = Header(min_length=1, max_length=255),
    x_document_type: str | None = Header(default=None, max_length=96),
    x_allowed_roles: str | None = Header(default=None),
    x_allowed_users: str | None = Header(default=None),
) -> HeldIngestResponse:
    require_admin(principal)
    document_name = validate_document_name(x_document_name)
    document_type = validate_document_type(x_document_type)
    content = await read_limited_body(request)
    if not content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document cannot be empty")
    content_type = request.headers.get("content-type", "")
    require_active_trial(principal)
    if is_pdf(document_name, content_type):
        await reserve_pdf_trial_slot(session, principal)
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)
    job = await create_held_job(session=session, principal=principal, document_name=document_name, content=content, content_type=content_type, allowed_roles=allowed_roles, allowed_users=allowed_users, document_type=document_type)
    return HeldIngestResponse(job_id=job.job_id, message=job.message)


@app.post("/v1/documents/stream")
async def stream_ingest_document(
    request: Request,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
    x_document_name: str = Header(min_length=1, max_length=255),
    x_document_type: str | None = Header(default=None, max_length=96),
    x_allowed_roles: str | None = Header(default=None),
    x_allowed_users: str | None = Header(default=None),
) -> StreamingResponse:
    require_admin(principal)
    document_name = validate_document_name(x_document_name)
    document_type = validate_document_type(x_document_type)
    content = await read_limited_body(request)
    if not content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Document cannot be empty")
    content_type = request.headers.get("content-type", "")
    require_active_trial(principal)
    if is_pdf(document_name, content_type):
        await reserve_pdf_trial_slot(session, principal)
    allowed_roles = parse_acl(x_allowed_roles) or principal.roles
    allowed_users = parse_acl(x_allowed_users)
    job = await create_held_job(session=session, principal=principal, document_name=document_name, content=content, content_type=content_type, allowed_roles=allowed_roles, allowed_users=allowed_users, document_type=document_type)

    async def events():
        yield encode_event({
            "type": "complete", "percentage": 100, "job_id": job.job_id, "state": job.state,
            "chunks_indexed": 0, "tables_indexed": 0, "visuals_indexed": 0, "reindexed": False,
            "message": job.message,
        })

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})


@app.get("/v1/admin/ingestion-jobs", response_model=list[IngestionJobResponse])
async def list_ingestion_jobs(
    state: str | None = None,
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> list[IngestionJobResponse]:
    require_admin(principal)
    statement = select(IngestionJobRecord).where(IngestionJobRecord.tenant_id == principal.tenant_id)
    if state:
        statement = statement.where(IngestionJobRecord.state == state)
    jobs = list(
        await session.scalars(
            statement.order_by(
                IngestionJobRecord.created_at.desc(),
                IngestionJobRecord.job_id.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
    )
    return [job_response(job) for job in jobs]


@app.get("/v1/admin/documents", response_model=list[IndexedDocumentResponse])
async def list_indexed_documents(
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> list[IndexedDocumentResponse]:
    require_admin(principal)
    documents = await list_documents(session, principal.tenant_id)
    return [indexed_document_response(document) for document in documents]


@app.post("/v1/admin/compute-sessions", response_model=ComputeSessionResponse, status_code=status.HTTP_201_CREATED)
async def open_compute_session(
    payload: ComputeSessionCreate,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> ComputeSessionResponse:
    require_admin(principal)
    require_active_trial(principal)
    settings = get_settings()
    if not settings.gpu_dispatch_enabled:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GPU dispatch is disabled by configuration; no provider was contacted.")
    existing = await get_open_compute_session(session, principal.tenant_id)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A compute session is already open")
    record_ = ComputeSessionRecord(
        session_id=str(uuid4()), tenant_id=principal.tenant_id, provider=settings.compute_provider, status="open",
        max_jobs=payload.max_jobs, max_gpu_minutes=payload.max_gpu_minutes,
        max_estimated_cost_usd=payload.max_estimated_cost_usd, released_job_count=0,
        gpu_seconds=0, estimated_cost_usd=0, created_by=principal.user_id,
    )
    session.add(record_)
    await session.commit()
    await session.refresh(record_)
    await record(session, "compute_session_opened", principal.tenant_id, principal.user_id, compute_session_id=record_.session_id, provider=record_.provider)
    return await compute_session_payload(session, record_)


async def owned_compute_session(session: AsyncSession, principal: Principal, session_id: str) -> ComputeSessionRecord:
    record_ = await session.scalar(select(ComputeSessionRecord).where(ComputeSessionRecord.session_id == session_id, ComputeSessionRecord.tenant_id == principal.tenant_id))
    if record_ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Compute session not found")
    return record_


@app.post("/v1/admin/compute-sessions/{session_id}/release", response_model=ComputeSessionResponse)
async def release_compute_jobs(
    session_id: str,
    payload: ComputeSessionRelease,
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> ComputeSessionResponse:
    require_admin(principal)
    require_active_trial(principal)
    settings = get_settings()
    if not settings.gpu_dispatch_enabled:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="GPU dispatch is disabled; no provider was contacted.")
    record_ = await owned_compute_session(session, principal, session_id)
    if record_.status != "open":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Compute session is not open")
    if len(payload.job_ids) != len(set(payload.job_ids)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Job IDs must be unique")
    jobs = list(await session.scalars(select(IngestionJobRecord).where(IngestionJobRecord.job_id.in_(payload.job_ids), IngestionJobRecord.tenant_id == principal.tenant_id)))
    if len(jobs) != len(payload.job_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more jobs were not found")
    if any(job.state != "held_for_compute" for job in jobs):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only held jobs can be released")
    try:
        assert_release_within_limits(
            released_job_count=record_.released_job_count, requested_jobs=len(jobs), max_jobs=record_.max_jobs,
            gpu_seconds=record_.gpu_seconds, max_gpu_minutes=record_.max_gpu_minutes,
            estimated_cost_usd=record_.estimated_cost_usd, max_estimated_cost_usd=record_.max_estimated_cost_usd,
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if record_.provider != "local_docker":
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Hosted worker artifact exchange is not configured; no provider was contacted.")
    for job in jobs:
        job.state, job.stage, job.progress = "provider_queued", "provider_queue", 0
        job.message = "Released into the bounded compute session."
        job.compute_session_id = record_.session_id
    record_.released_job_count += len(jobs)
    await session.commit()
    await record(session, "compute_jobs_released", principal.tenant_id, principal.user_id, compute_session_id=record_.session_id, job_ids=payload.job_ids)
    task = asyncio.create_task(run_local_compute_session(record_.session_id, payload.job_ids))
    compute_tasks[record_.session_id] = task
    return await compute_session_payload(session, record_)


@app.post("/v1/admin/compute-sessions/{session_id}/drain", response_model=ComputeSessionResponse)
async def drain_compute_session(session_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> ComputeSessionResponse:
    require_admin(principal)
    record_ = await owned_compute_session(session, principal, session_id)
    if record_.status == "open":
        record_.status = "draining"
        await session.commit()
    return await compute_session_payload(session, record_)


@app.post("/v1/admin/compute-sessions/{session_id}/cancel", response_model=ComputeSessionResponse)
async def cancel_compute_session(session_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> ComputeSessionResponse:
    require_admin(principal)
    record_ = await owned_compute_session(session, principal, session_id)
    task = compute_tasks.get(session_id)
    if task is not None:
        task.cancel()
    await session.execute(
        update(IngestionJobRecord).where(
            IngestionJobRecord.compute_session_id == session_id,
            IngestionJobRecord.state.in_(["provider_queued", "cold_start", "processing", "retrying"]),
        ).values(state="held_for_compute", stage="held", progress=0, message="Session cancelled; document returned to held state.")
    )
    record_.status = "closed"
    record_.closed_at = func.now()
    await session.commit()
    return await compute_session_payload(session, record_)


@app.get("/v1/admin/compute-sessions/{session_id}", response_model=ComputeSessionResponse)
async def get_compute_session(session_id: str, principal: Principal = Depends(require_principal), session: AsyncSession = Depends(get_session)) -> ComputeSessionResponse:
    require_admin(principal)
    return await compute_session_payload(session, await owned_compute_session(session, principal, session_id))


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


@app.delete("/v1/admin/documents", response_model=BulkDeleteResponse)
async def delete_all_documents(
    principal: Principal = Depends(require_principal),
    session: AsyncSession = Depends(get_session),
) -> BulkDeleteResponse:
    require_admin(principal)
    documents = await list_documents(session, principal.tenant_id, limit=None)
    if not documents:
        return BulkDeleteResponse(deleted_count=0, status="deleted")
    await vectors.delete_documents(
        principal.tenant_id,
        [document.document_id for document in documents],
    )
    await mark_documents_deleted(session, documents)
    await record(
        session,
        "documents_bulk_deleted",
        principal.tenant_id,
        principal.user_id,
        deleted_count=len(documents),
    )
    return BulkDeleteResponse(deleted_count=len(documents), status="deleted")


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
    require_active_trial(principal)
    require_compute_for_query()
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
    require_active_trial(principal)
    require_compute_for_query()
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
