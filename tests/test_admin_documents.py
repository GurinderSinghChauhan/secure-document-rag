from datetime import UTC, datetime

import pytest

from app.database import DocumentRecord
from app.main import delete_document, list_indexed_documents
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
