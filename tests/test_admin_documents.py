from datetime import UTC, datetime

import pytest

from app.database import DocumentRecord
from app.main import classify_document_manually, delete_all_documents, delete_document, list_indexed_documents
from app.models import ClassifyDocumentRequest, Principal
from app.repository import delete_document_record, get_latest_document_source


class DocumentSession:
    def __init__(self, documents):
        self.documents = documents
        self.statement = None

    async def scalars(self, statement):
        self.statement = statement
        return self.documents


class DeleteSession:
    def __init__(self):
        self.statement = None
        self.deleted = None
        self.committed = False

    async def execute(self, statement):
        self.statement = statement

    async def delete(self, record):
        self.deleted = record

    async def commit(self):
        self.committed = True


def admin(tenant_id="org-a"):
    return Principal(tenant_id=tenant_id, user_id="admin-a", roles=["admin"])


@pytest.mark.asyncio
async def test_latest_pipeline_source_is_tenant_scoped_and_completed_only():
    session = type("Session", (), {})()
    session.statement = None

    async def scalar(statement):
        session.statement = statement
        return None

    session.scalar = scalar

    await get_latest_document_source(session, "org-a", "document-a")

    sql = str(session.statement.compile(compile_kwargs={"literal_binds": True}))
    assert "ingestion_jobs.tenant_id = 'org-a'" in sql
    assert "ingestion_jobs.result_document_id = 'document-a'" in sql
    assert "ingestion_jobs.state = 'completed'" in sql
    assert "ingestion_jobs.updated_at DESC" in sql
    assert "LIMIT 1" in sql


@pytest.mark.asyncio
async def test_admin_document_inventory_is_scoped_to_active_tenant_documents():
    document = DocumentRecord(
        document_id="document-a",
        tenant_id="org-a",
        document_name="policy.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        size_bytes=1024,
        chunk_count=12,
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="admin-a",
        created_at=datetime.now(UTC),
    )
    session = DocumentSession([document])

    result = await list_indexed_documents(
        limit=500,
        offset=500,
        principal=admin(),
        session=session,
    )
    sql = str(session.statement.compile(compile_kwargs={"literal_binds": True}))

    assert result[0].document_name == "policy.pdf"
    assert "documents.tenant_id = 'org-a'" in sql
    assert "documents.deleted_at IS NULL" in sql
    assert "documents.created_at DESC, documents.document_id DESC" in sql
    assert "LIMIT 500 OFFSET 500" in sql


@pytest.mark.asyncio
async def test_document_delete_uses_calling_admin_tenant(monkeypatch):
    requested = {}

    async def missing_document(_session, tenant_id, document_id):
        requested.update(tenant_id=tenant_id, document_id=document_id)
        return None

    monkeypatch.setattr("app.main.get_document", missing_document)

    with pytest.raises(Exception, match="Document not found"):
        await delete_document("document-from-another-org", admin("org-a"), object())

    assert requested == {"tenant_id": "org-a", "document_id": "document-from-another-org"}


@pytest.mark.asyncio
async def test_document_delete_removes_document_record(monkeypatch):
    document = DocumentRecord(document_id="document-a", tenant_id="org-a")
    calls = {}

    async def get_active(_session, tenant_id, document_id):
        calls["lookup"] = (tenant_id, document_id)
        return document

    async def delete_vectors(tenant_id, document_id):
        calls["vectors"] = (tenant_id, document_id)

    async def delete_record(_session, record):
        calls["record"] = record

    async def audit(_session, action, tenant_id, user_id, **metadata):
        calls["audit"] = (action, tenant_id, user_id, metadata)

    monkeypatch.setattr("app.main.get_document", get_active)
    monkeypatch.setattr("app.main.vectors.delete_document", delete_vectors)
    monkeypatch.setattr("app.main.delete_document_record", delete_record)
    monkeypatch.setattr("app.main.record", audit)

    result = await delete_document("document-a", admin("org-a"), object())

    assert result.status == "deleted"
    assert calls["lookup"] == ("org-a", "document-a")
    assert calls["vectors"] == ("org-a", "document-a")
    assert calls["record"] is document
    assert calls["audit"] == (
        "document_deleted",
        "org-a",
        "admin-a",
        {"document_id": "document-a"},
    )


@pytest.mark.asyncio
async def test_document_record_delete_removes_retained_pipeline_sources():
    document = DocumentRecord(document_id="document-a", tenant_id="org-a")
    session = DeleteSession()

    await delete_document_record(session, document)

    sql = str(session.statement.compile(compile_kwargs={"literal_binds": True}))
    assert "DELETE FROM ingestion_jobs" in sql
    assert "ingestion_jobs.tenant_id = 'org-a'" in sql
    assert "ingestion_jobs.result_document_id = 'document-a'" in sql
    assert session.deleted is document
    assert session.committed is True


@pytest.mark.asyncio
async def test_delete_all_documents_is_tenant_scoped_and_batched(monkeypatch):
    documents = [
        DocumentRecord(document_id="document-a", tenant_id="org-a"),
        DocumentRecord(document_id="document-b", tenant_id="org-a"),
    ]
    calls = {}

    async def list_active(_session, tenant_id, limit):
        calls["list"] = (tenant_id, limit)
        return documents

    async def delete_vectors(tenant_id, document_ids):
        calls["vectors"] = (tenant_id, document_ids)

    async def mark_deleted(_session, records):
        calls["records"] = records

    async def audit(_session, action, tenant_id, user_id, **metadata):
        calls["audit"] = (action, tenant_id, user_id, metadata)

    monkeypatch.setattr("app.main.list_documents", list_active)
    monkeypatch.setattr("app.main.vectors.delete_documents", delete_vectors)
    monkeypatch.setattr("app.main.mark_documents_deleted", mark_deleted)
    monkeypatch.setattr("app.main.record", audit)

    result = await delete_all_documents(admin("org-a"), object())

    assert result.deleted_count == 2
    assert calls["list"] == ("org-a", None)
    assert calls["vectors"] == ("org-a", ["document-a", "document-b"])
    assert calls["records"] == documents
    assert calls["audit"] == (
        "documents_bulk_deleted",
        "org-a",
        "admin-a",
        {"deleted_count": 2},
    )


@pytest.mark.asyncio
async def test_failed_document_can_be_classified_manually(monkeypatch):
    document = DocumentRecord(
        document_id="document-a",
        tenant_id="org-a",
        document_name="invoice.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        size_bytes=1024,
        chunk_count=4,
        classification_status="failed",
        allowed_roles=["admin"],
        allowed_users=["member-a"],
        created_by="admin-a",
    )
    source = type("Source", (), {"content": b"source-pdf"})()
    queued_job = type(
        "QueuedJob",
        (),
        {
            "job_id": "job-classification",
            "state": "held_for_compute",
            "message": "Document saved and waiting.",
            "content_type": "application/pdf",
            "size_bytes": len(source.content),
        },
    )()
    calls = {}

    async def find_document(_session, tenant_id, document_id):
        calls["document"] = (tenant_id, document_id)
        return document

    async def find_source(_session, tenant_id, document_id):
        calls["source"] = (tenant_id, document_id)
        return source

    async def queue_job(**kwargs):
        calls["job"] = kwargs
        return queued_job

    async def audit(_session, action, tenant_id, user_id, **metadata):
        calls["audit"] = (action, tenant_id, user_id, metadata)

    monkeypatch.setattr("app.main.get_document", find_document)
    monkeypatch.setattr("app.main.get_latest_document_source", find_source)
    monkeypatch.setattr("app.main.create_held_job", queue_job)
    monkeypatch.setattr("app.main.record", audit)

    result = await classify_document_manually(
        "document-a",
        ClassifyDocumentRequest(document_type="accounts_payable.invoice"),
        Principal(
            tenant_id="org-a",
            user_id="admin-a",
            roles=["admin"],
            is_super_admin=True,
        ),
        object(),
    )

    assert result.job_id == "job-classification"
    assert result.recommended_gpu_minutes > 0
    assert calls["document"] == ("org-a", "document-a")
    assert calls["source"] == ("org-a", "document-a")
    assert calls["job"]["content"] == b"source-pdf"
    assert calls["job"]["document_type"] == "accounts_payable.invoice"
    assert calls["job"]["allowed_roles"] == ["admin"]
    assert calls["audit"][0] == "document_manual_classification_queued"
    assert calls["audit"][3]["document_type"] == "accounts_payable.invoice"


@pytest.mark.asyncio
async def test_confirmed_document_cannot_be_manually_reclassified(monkeypatch):
    document = DocumentRecord(
        document_id="document-a",
        tenant_id="org-a",
        document_name="legacy.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        size_bytes=1024,
        chunk_count=4,
        document_type="accounts_payable.invoice",
        classification_status="confirmed",
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="admin-a",
    )

    async def find_document(*_):
        return document

    monkeypatch.setattr("app.main.get_document", find_document)

    with pytest.raises(Exception, match="Only documents that failed automatic classification"):
        await classify_document_manually(
            "document-a",
            ClassifyDocumentRequest(document_type="accounts_payable.invoice"),
            Principal(
                tenant_id="org-a",
                user_id="admin-a",
                roles=["admin"],
                is_super_admin=True,
            ),
            object(),
        )


@pytest.mark.asyncio
async def test_manual_classification_requires_retained_source(monkeypatch):
    document = DocumentRecord(
        document_id="document-a",
        tenant_id="org-a",
        document_name="legacy.pdf",
        content_type="application/pdf",
        content_sha256="a" * 64,
        size_bytes=1024,
        chunk_count=4,
        classification_status="unclassified",
        allowed_roles=["admin"],
        allowed_users=[],
        created_by="admin-a",
    )

    async def find_document(*_):
        return document

    async def missing_source(*_):
        return None

    monkeypatch.setattr("app.main.get_document", find_document)
    monkeypatch.setattr("app.main.get_latest_document_source", missing_source)

    with pytest.raises(Exception, match="original source is unavailable"):
        await classify_document_manually(
            "document-a",
            ClassifyDocumentRequest(document_type="accounts_payable.invoice"),
            Principal(
                tenant_id="org-a",
                user_id="admin-a",
                roles=["admin"],
                is_super_admin=True,
            ),
            object(),
        )
