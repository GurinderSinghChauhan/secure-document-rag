from app.database import DocumentRecord
from app.main import existing_document_event


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
