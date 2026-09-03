from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app import main
from app.database import ComputeSessionRecord, DocumentRecord, IngestionJobRecord
from app.main import existing_document_event
from app.models import Principal
from app.repository import get_document_by_content_hash


def test_existing_document_event_returns_existing_document_as_success() -> None:
    document = DocumentRecord(
        document_id="00000000-0000-0000-0000-000000000001",
        tenant_id="tenant-a",
        document_name="policy.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        size_bytes=123,
        chunk_count=17,
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="user-a",
    )

    assert existing_document_event(document) == {
        "type": "complete",
        "percentage": 100,
        "document_id": "00000000-0000-0000-0000-000000000001",
        "chunks_indexed": 17,
        "tables_indexed": 0,
        "visuals_indexed": 0,
        "reindexed": False,
        "message": "Document is searchable",
    }


class CapturingSession:
    def __init__(self):
        self.statement = None

    async def scalar(self, statement):
        self.statement = statement
        return None


@pytest.mark.asyncio
async def test_content_hash_lookup_can_include_soft_deleted_documents() -> None:
    session = CapturingSession()

    await get_document_by_content_hash(session, "tenant-a", "a" * 64, include_deleted=True)

    sql = str(session.statement.compile(compile_kwargs={"literal_binds": True}))
    assert "documents.tenant_id = 'tenant-a'" in sql
    assert "documents.content_sha256" in sql
    assert "documents.deleted_at IS NULL" not in sql


@pytest.mark.asyncio
async def test_deleted_duplicate_is_purged_before_reupload_and_reclassifies(monkeypatch) -> None:
    deleted_at = datetime.now(UTC)
    document = DocumentRecord(
        document_id="00000000-0000-0000-0000-000000000001",
        tenant_id="tenant-a",
        document_name="old.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        size_bytes=100,
        chunk_count=1,
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="user-a",
        deleted_at=deleted_at,
    )
    session = AsyncMock()
    session.add = MagicMock()
    session.scalar = AsyncMock(return_value=document)
    delete_document = AsyncMock()
    upsert_document = AsyncMock()
    extract_metadata = AsyncMock(return_value={"invoice_number": "INV-42", "total_amount": "1250.00"})
    classify_document = AsyncMock(return_value=("accounts_payable.invoice", 0.93))

    async def embed_batches(_chunks):
        yield 1, 1, [[0.1, 0.2]]

    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: SimpleNamespace(mineru_enabled=False, max_visuals_per_document=10, max_document_chunks=100),
    )
    monkeypatch.setattr(
        main,
        "extract_document",
        lambda *_args: SimpleNamespace(text="restored text", visuals=[], described_visual_count=0, table_count=0),
    )
    monkeypatch.setattr(main, "chunk_text", lambda _text: ["restored text"])
    monkeypatch.setattr(main.model_server, "embed_batches", embed_batches)
    monkeypatch.setattr(main.model_server, "extract_metadata", extract_metadata)
    monkeypatch.setattr(main.model_server, "classify_document", classify_document)
    monkeypatch.setattr(main.vectors, "delete_document", delete_document)
    monkeypatch.setattr(main.vectors, "upsert_document", upsert_document)
    monkeypatch.setattr(main, "record", AsyncMock())

    events = [
        event
        async for event in main.index_document_events(
            b"restored content",
            "application/pdf",
            "a" * 64,
            "restored.pdf",
            ["admin"],
            [],
            Principal(tenant_id="tenant-a", user_id="user-a", roles=["admin"]),
            session,
            None,
        )
    ]

    assert any(event.get("stage") == "metadata_extraction" for event in events)
    assert events[-1]["percentage"] == 100
    assert events[-1]["document_id"] != document.document_id
    assert events[-1]["message"] == "Document is searchable"
    delete_document.assert_not_awaited()
    assert upsert_document.await_args.args[1] == events[-1]["document_id"]
    extract_metadata.assert_awaited_once()
    assert extract_metadata.await_args.args[0] == "Invoice"
    assert "invoice_number" in extract_metadata.await_args.args[1]
    classify_document.assert_awaited_once()
    session.delete.assert_awaited_once_with(document)
    session.flush.assert_awaited_once()
    assert session.add.call_args.args[0].document_type == "accounts_payable.invoice"


@pytest.mark.asyncio
async def test_reupload_without_delete_keeps_completed_classification_and_updates_metadata(monkeypatch) -> None:
    document = DocumentRecord(
        document_id="00000000-0000-0000-0000-000000000002",
        tenant_id="tenant-a",
        document_name="invoice.pdf",
        document_type="accounts_payable.invoice",
        schema_version=2,
        classification_status="confirmed",
        classification_source="automatic",
        classification_confidence=0.91,
        content_type="application/pdf",
        content_sha256="b" * 64,
        size_bytes=100,
        chunk_count=1,
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="user-a",
    )
    session = AsyncMock()

    async def embed_batches(_chunks):
        yield 1, 1, [[0.1, 0.2]]

    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: SimpleNamespace(
            mineru_enabled=False,
            max_visuals_per_document=10,
            max_document_chunks=100,
            classification_auto_accept_threshold=0.85,
            classification_review_threshold=0.60,
        ),
    )
    monkeypatch.setattr(
        main,
        "extract_document",
        lambda *_args: SimpleNamespace(
            text="Invoice INV-42 from Example Vendor for 1250.00",
            visuals=[],
            described_visual_count=0,
            table_count=0,
        ),
    )
    monkeypatch.setattr(main, "chunk_text", lambda _text: ["invoice text"])
    monkeypatch.setattr(main.model_server, "embed_batches", embed_batches)
    classify_document = AsyncMock(return_value=("contracts.service_agreement", 0.99))
    monkeypatch.setattr(
        main.model_server,
        "classify_document",
        classify_document,
    )
    monkeypatch.setattr(
        main.model_server,
        "extract_metadata",
        AsyncMock(return_value={"invoice_number": "INV-42"}),
    )
    monkeypatch.setattr(main.vectors, "delete_document", AsyncMock())
    monkeypatch.setattr(main.vectors, "upsert_document", AsyncMock())
    monkeypatch.setattr(main, "record", AsyncMock())

    events = [
        event
        async for event in main.index_document_events(
            b"invoice content",
            "application/pdf",
            "b" * 64,
            "unknown.pdf",
            ["admin"],
            [],
            Principal(tenant_id="tenant-a", user_id="user-a", roles=["admin"]),
            session,
            document,
        )
    ]

    assert document.document_type == "accounts_payable.invoice"
    assert document.classification_status == "confirmed"
    assert document.classification_source == "automatic"
    assert document.classification_confidence == 0.91
    assert document.extraction_status == "completed"
    assert document.extracted_metadata == {"invoice_number": "INV-42"}
    assert [event.get("stage") for event in events if event.get("type") == "progress"][:3] == [
        "extracting",
        "metadata_extraction",
        "chunking",
    ]
    classify_document.assert_not_awaited()


@pytest.mark.asyncio
async def test_compute_failure_after_rollback_is_persisted_with_sql_update(monkeypatch) -> None:
    compute_session = ComputeSessionRecord(
        session_id="session-a",
        tenant_id="tenant-a",
        provider="local_docker",
        status="open",
        max_jobs=1,
        max_gpu_minutes=10,
        max_estimated_cost_usd=None,
        released_job_count=1,
        gpu_seconds=0,
        estimated_cost_usd=0,
        created_by="user-a",
    )
    job = IngestionJobRecord(
        job_id="job-a",
        tenant_id="tenant-a",
        state="provider_queued",
        stage="queued",
        progress=0,
        message="Queued",
        document_name="policy.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        content=b"content",
        size_bytes=7,
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="user-a",
        attempt_count=0,
        retry_limit=3,
        chunks_indexed=0,
        tables_indexed=0,
        visuals_indexed=0,
        gpu_seconds=0,
        estimated_cost_usd=0,
    )
    session = AsyncMock()

    async def get_record(model, _record_id):
        return compute_session if model is ComputeSessionRecord else job

    session.get.side_effect = get_record
    session.scalar.side_effect = [compute_session, 3, compute_session, None]

    class SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    async def failing_events(*_args, **_kwargs):
        yield {"type": "progress", "percentage": 96, "stage": "metadata", "message": "Saving document metadata"}
        await session.rollback()
        raise RuntimeError("metadata commit failed")

    monkeypatch.setattr(main, "SessionFactory", SessionContext)
    monkeypatch.setattr(main, "get_document_by_content_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(main, "index_document_events", failing_events)
    monkeypatch.setattr(
        main,
        "get_settings",
        lambda: SimpleNamespace(compute_gpu_hourly_cost_usd=0.5),
    )

    await main.run_local_compute_session("session-a", ["job-a"])

    update_parameters = [
        call.args[0].compile().params
        for call in session.execute.await_args_list
        if call.args and hasattr(call.args[0], "compile")
    ]
    failure_updates = [parameters for parameters in update_parameters if parameters.get("error_code") == "processing_failed"]
    assert len(failure_updates) == 1
    assert failure_updates[0]["stage"] == "held"
    assert failure_updates[0]["progress"] == 0
    assert failure_updates[0]["error_code"] == "processing_failed"
