from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .database import AuditEvent, DocumentRecord


async def create_document(session: AsyncSession, record: DocumentRecord) -> None:
    session.add(record)
    await session.commit()


async def document_exists(session: AsyncSession, tenant_id: str, content_sha256: str) -> bool:
    result = await session.scalar(
        select(DocumentRecord.document_id).where(
            DocumentRecord.tenant_id == tenant_id,
            DocumentRecord.content_sha256 == content_sha256,
            DocumentRecord.deleted_at.is_(None),
        )
    )
    return result is not None


async def get_document(session: AsyncSession, tenant_id: str, document_id: str) -> DocumentRecord | None:
    return await session.scalar(
        select(DocumentRecord).where(
            DocumentRecord.tenant_id == tenant_id,
            DocumentRecord.document_id == document_id,
            DocumentRecord.deleted_at.is_(None),
        )
    )


async def mark_document_deleted(session: AsyncSession, record: DocumentRecord) -> None:
    record.deleted_at = datetime.now(UTC)
    await session.commit()


async def write_audit_event(session: AsyncSession, tenant_id: str, user_id: str, action: str, details: dict[str, object]) -> None:
    session.add(AuditEvent(tenant_id=tenant_id, user_id=user_id, action=action, details=details))
    await session.commit()


async def database_is_ready(session: AsyncSession) -> bool:
    return (await session.scalar(text("SELECT 1"))) == 1
