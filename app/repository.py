from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .database import AuditEvent, ChatMessageRecord, ChatSessionRecord, DocumentRecord


async def create_document(session: AsyncSession, record: DocumentRecord) -> None:
    session.add(record)
    await session.commit()


async def get_document_by_content_hash(session: AsyncSession, tenant_id: str, content_sha256: str) -> DocumentRecord | None:
    return await session.scalar(
        select(DocumentRecord).where(
            DocumentRecord.tenant_id == tenant_id,
            DocumentRecord.content_sha256 == content_sha256,
            DocumentRecord.deleted_at.is_(None),
        )
    )


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


async def create_chat(session: AsyncSession, tenant_id: str, user_id: str, title: str) -> ChatSessionRecord:
    chat = ChatSessionRecord(chat_id=str(uuid4()), tenant_id=tenant_id, user_id=user_id, title=title)
    session.add(chat)
    await session.commit()
    await session.refresh(chat)
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
