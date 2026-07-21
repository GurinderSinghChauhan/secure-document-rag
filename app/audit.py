from sqlalchemy.ext.asyncio import AsyncSession

from .repository import write_audit_event


async def record(session: AsyncSession, action: str, tenant_id: str, user_id: str, **metadata: object) -> None:
    await write_audit_event(session, tenant_id, user_id, action, metadata)
