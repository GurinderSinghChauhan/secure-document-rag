from datetime import UTC, datetime

import pytest

from app.database import DocumentRecord
from app.main import delete_all_documents, delete_document, list_indexed_documents
from app.models import Principal


class DocumentSession:
    def __init__(self, documents):
        self.documents = documents
        self.statement = None

    async def scalars(self, statement):
        self.statement = statement
        return self.documents


def admin(tenant_id="org-a"):
    return Principal(tenant_id=tenant_id, user_id="admin-a", roles=["admin"])


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

    result = await list_indexed_documents(admin(), session)
    sql = str(session.statement.compile(compile_kwargs={"literal_binds": True}))

    assert result[0].document_name == "policy.pdf"
    assert "documents.tenant_id = 'org-a'" in sql
    assert "documents.deleted_at IS NULL" in sql


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
