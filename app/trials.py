from datetime import UTC, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import ChatMessageRecord, ChatSessionRecord, IngestionJobRecord, OrganizationRecord, UserRecord
from .models import Principal

TRIAL_DAYS = 7
TRIAL_PDF_DAILY_LIMIT = 2
TRIAL_QUESTION_DAILY_LIMIT = 5


def new_trial_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    started = now or datetime.now(UTC)
    return started, started + timedelta(days=TRIAL_DAYS)


def trial_payload(organization: OrganizationRecord, *, is_super_admin: bool = False) -> dict[str, object]:
    now = datetime.now(UTC)
    active = bool(is_super_admin or (organization.trial_ends_at and organization.trial_ends_at > now))
    return {
        "active": active,
        "started_at": organization.trial_started_at,
        "ends_at": organization.trial_ends_at,
        "pdf_daily_limit": None if is_super_admin else TRIAL_PDF_DAILY_LIMIT,
        "question_daily_limit": None if is_super_admin else TRIAL_QUESTION_DAILY_LIMIT,
        "timezone": "UTC",
        "extension_available": False,
    }


def require_active_trial(principal: Principal) -> None:
    if principal.is_super_admin:
        return
    if principal.trial_ends_at is None or principal.trial_ends_at <= datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Your 7-day free trial has ended. Extensions are not available yet.",
        )


def is_pdf(document_name: str, content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip().lower() == "application/pdf" or document_name.lower().endswith(".pdf")


def utc_day_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = now or datetime.now(UTC)
    day_start = datetime.combine(current.date(), time.min, tzinfo=UTC)
    return day_start, day_start + timedelta(days=1)


async def reserve_question_trial_slot(session: AsyncSession, principal: Principal, now: datetime | None = None) -> None:
    require_active_trial(principal)
    if principal.is_super_admin:
        return
    # Serialize submissions for this user so parallel requests cannot exceed the individual limit.
    await session.scalar(select(UserRecord.user_id).where(UserRecord.user_id == principal.user_id).with_for_update())
    day_start, day_end = utc_day_window(now)
    used = await session.scalar(
        select(func.count())
        .select_from(ChatMessageRecord)
        .join(ChatSessionRecord, ChatSessionRecord.chat_id == ChatMessageRecord.chat_id)
        .where(
            ChatSessionRecord.tenant_id == principal.tenant_id,
            ChatSessionRecord.user_id == principal.user_id,
            ChatMessageRecord.role == "user",
            ChatMessageRecord.created_at >= day_start,
            ChatMessageRecord.created_at < day_end,
        )
    )
    if (used or 0) >= TRIAL_QUESTION_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Free-trial limit reached: you can ask at most 5 questions per UTC day.",
        )


async def reserve_pdf_trial_slot(session: AsyncSession, principal: Principal) -> None:
    require_active_trial(principal)
    if principal.is_super_admin:
        return
    # Serialize submissions for this organization so parallel uploads cannot exceed the shared limit.
    await session.scalar(select(OrganizationRecord.organization_id).where(OrganizationRecord.organization_id == principal.tenant_id).with_for_update())
    day_start, day_end = utc_day_window()
    used = await session.scalar(
        select(func.count()).select_from(IngestionJobRecord).where(
            IngestionJobRecord.tenant_id == principal.tenant_id,
            or_(IngestionJobRecord.content_type.ilike("application/pdf%"), func.lower(IngestionJobRecord.document_name).like("%.pdf")),
            IngestionJobRecord.created_at >= day_start,
            IngestionJobRecord.created_at < day_end,
        )
    )
    if (used or 0) >= TRIAL_PDF_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Free-trial limit reached: at most 2 PDFs can be submitted per UTC day.",
        )
