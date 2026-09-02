from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import cast, delete, func, or_, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from .database import AuditEvent, ChatMessageRecord, ChatSessionRecord, DocumentRecord, IngestionJobRecord


async def create_document(session: AsyncSession, record: DocumentRecord) -> None:
    session.add(record)
    await session.commit()


async def get_document_by_content_hash(
    session: AsyncSession,
    tenant_id: str,
    content_sha256: str,
    *,
    include_deleted: bool = False,
) -> DocumentRecord | None:
    statement = select(DocumentRecord).where(
        DocumentRecord.tenant_id == tenant_id,
        DocumentRecord.content_sha256 == content_sha256,
    )
    if not include_deleted:
        statement = statement.where(DocumentRecord.deleted_at.is_(None))
    return await session.scalar(statement)


async def get_document(session: AsyncSession, tenant_id: str, document_id: str) -> DocumentRecord | None:
    return await session.scalar(
        select(DocumentRecord).where(
            DocumentRecord.tenant_id == tenant_id,
            DocumentRecord.document_id == document_id,
            DocumentRecord.deleted_at.is_(None),
        )
    )


async def get_latest_document_source(
    session: AsyncSession,
    tenant_id: str,
    document_id: str,
) -> IngestionJobRecord | None:
    return await session.scalar(
        select(IngestionJobRecord)
        .where(
            IngestionJobRecord.tenant_id == tenant_id,
            IngestionJobRecord.result_document_id == document_id,
            IngestionJobRecord.state == "completed",
        )
        .order_by(IngestionJobRecord.updated_at.desc(), IngestionJobRecord.job_id.desc())
        .limit(1)
    )


async def list_documents(
    session: AsyncSession,
    tenant_id: str,
    limit: int | None = 500,
    offset: int = 0,
) -> list[DocumentRecord]:
    statement = (
        select(DocumentRecord)
        .where(DocumentRecord.tenant_id == tenant_id, DocumentRecord.deleted_at.is_(None))
        .order_by(DocumentRecord.created_at.desc(), DocumentRecord.document_id.desc())
    )
    if offset:
        statement = statement.offset(offset)
    if limit is not None:
        statement = statement.limit(limit)
    result = await session.scalars(statement)
    return list(result)


async def list_authorized_documents(
    session: AsyncSession,
    tenant_id: str,
    roles: list[str],
    user_id: str,
) -> list[DocumentRecord]:
    access_conditions = [cast(DocumentRecord.allowed_users, JSONB).contains([user_id])]
    access_conditions.extend(cast(DocumentRecord.allowed_roles, JSONB).contains([role]) for role in roles)
    result = await session.scalars(
        select(DocumentRecord)
        .where(
            DocumentRecord.tenant_id == tenant_id,
            DocumentRecord.deleted_at.is_(None),
            or_(*access_conditions),
        )
        .order_by(DocumentRecord.created_at.desc(), DocumentRecord.document_id.desc())
    )
    return list(result)


async def search_authorized_documents(
    session: AsyncSession,
    tenant_id: str,
    roles: list[str],
    user_id: str,
    query: str,
    document_type_keys: list[str],
    limit: int,
    offset: int,
) -> tuple[list[DocumentRecord], int]:
    access_conditions = [cast(DocumentRecord.allowed_users, JSONB).contains([user_id])]
    access_conditions.extend(cast(DocumentRecord.allowed_roles, JSONB).contains([role]) for role in roles)
    filters = [
        DocumentRecord.tenant_id == tenant_id,
        DocumentRecord.deleted_at.is_(None),
        or_(*access_conditions),
    ]
    if query:
        search_conditions = [
            DocumentRecord.document_name.icontains(query, autoescape=True)
        ]
        if document_type_keys:
            search_conditions.append(DocumentRecord.document_type.in_(document_type_keys))
        filters.append(or_(*search_conditions))
    total = await session.scalar(
        select(func.count()).select_from(DocumentRecord).where(*filters)
    )
    result = await session.scalars(
        select(DocumentRecord)
        .where(*filters)
        .order_by(DocumentRecord.created_at.desc(), DocumentRecord.document_id.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result), int(total or 0)


async def mark_document_deleted(session: AsyncSession, record: DocumentRecord) -> None:
    record.deleted_at = datetime.now(UTC)
    await session.commit()


async def mark_documents_deleted(session: AsyncSession, records: list[DocumentRecord]) -> None:
    deleted_at = datetime.now(UTC)
    for record in records:
        record.deleted_at = deleted_at
    await session.commit()


async def delete_document_record(session: AsyncSession, record: DocumentRecord) -> None:
    await session.execute(
        delete(IngestionJobRecord).where(
            IngestionJobRecord.tenant_id == record.tenant_id,
            IngestionJobRecord.result_document_id == record.document_id,
        )
    )
    await session.delete(record)
    await session.commit()


async def write_audit_event(session: AsyncSession, tenant_id: str, user_id: str, action: str, details: dict[str, object]) -> None:
    session.add(AuditEvent(tenant_id=tenant_id, user_id=user_id, action=action, details=details))
    await session.commit()


async def create_chat(session: AsyncSession, tenant_id: str, user_id: str, title: str) -> ChatSessionRecord:
    chat = ChatSessionRecord(chat_id=str(uuid4()), tenant_id=tenant_id, user_id=user_id, title=title)
    session.add(chat)
    await session.flush()
    return chat


async def get_chat(session: AsyncSession, tenant_id: str, user_id: str, chat_id: str) -> ChatSessionRecord | None:
    return await session.scalar(
        select(ChatSessionRecord).where(
            ChatSessionRecord.chat_id == chat_id,
            ChatSessionRecord.tenant_id == tenant_id,
            ChatSessionRecord.user_id == user_id,
        )
    )


async def list_chats(session: AsyncSession, tenant_id: str, user_id: str, limit: int = 50) -> list[ChatSessionRecord]:
    result = await session.scalars(
        select(ChatSessionRecord)
        .where(ChatSessionRecord.tenant_id == tenant_id, ChatSessionRecord.user_id == user_id)
        .order_by(ChatSessionRecord.updated_at.desc())
        .limit(limit)
    )
    return list(result)


async def list_chat_messages(session: AsyncSession, chat_id: str) -> list[ChatMessageRecord]:
    result = await session.scalars(
        select(ChatMessageRecord)
        .where(ChatMessageRecord.chat_id == chat_id)
        .order_by(ChatMessageRecord.created_at.asc(), ChatMessageRecord.message_id.asc())
    )
    return list(result)


async def add_chat_message(session: AsyncSession, chat: ChatSessionRecord, role: str, content: str) -> ChatMessageRecord:
    message = ChatMessageRecord(message_id=str(uuid4()), chat_id=chat.chat_id, role=role, content=content)
    chat.updated_at = datetime.now(UTC)
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def database_is_ready(session: AsyncSession) -> bool:
    return (await session.scalar(text("SELECT 1"))) == 1
