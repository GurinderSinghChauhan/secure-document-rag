from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import record
from .auth import require_principal, require_super_admin
from .database import (
    DocumentRecord,
    ChatMessageRecord,
    ChatResponseEvaluationRecord,
    ChatSessionRecord,
    IngestionJobRecord,
    MembershipRecord,
    OrganizationRecord,
    RefreshSessionRecord,
    UserRecord,
    get_session,
)
from .models import Principal

router = APIRouter(prefix="/v1/super-admin", tags=["super-admin"])


class StatusUpdate(BaseModel):
    active: bool


class PlatformRoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def valid_role(cls, value: str) -> str:
        if value not in {"admin", "member"}:
            raise ValueError("Role must be admin or member")
        return value


class ResponseEvaluationUpdate(BaseModel):
    correctness: int
    relevance: int
    clarity: int
    notes: str | None = None

    @field_validator("correctness", "relevance", "clarity")
    @classmethod
    def valid_rating(cls, value: int) -> int:
        if not 1 <= value <= 5:
            raise ValueError("Ratings must be between 1 and 5")
        return value

    @field_validator("notes")
    @classmethod
    def valid_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > 2_000:
            raise ValueError("Notes must be 2,000 characters or fewer")
        return value or None


async def super_principal(principal: Principal = Depends(require_principal)) -> Principal:
    return require_super_admin(principal)


async def organization_members(session: AsyncSession, organization_id: str) -> list[dict[str, object]]:
    rows = (await session.execute(
        select(UserRecord, MembershipRecord)
        .join(MembershipRecord, MembershipRecord.user_id == UserRecord.user_id)
        .where(MembershipRecord.organization_id == organization_id)
        .order_by(UserRecord.display_name, UserRecord.email)
    )).all()
    return [
        {
            "user_id": user.user_id,
            "email": user.email,
            "display_name": user.display_name,
            "role": membership.role,
            "active": user.active,
            "is_super_admin": bool(user.is_super_admin),
            "email_verified": user.email_verified,
            "created_at": user.created_at,
        }
        for user, membership in rows
    ]


@router.get("/organizations")
async def list_organizations(
    _: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, object]]:
    organizations = list(await session.scalars(select(OrganizationRecord).order_by(OrganizationRecord.name, OrganizationRecord.slug)))
    result = []
    for organization in organizations:
        members = await organization_members(session, organization.organization_id)
        document_count = await session.scalar(
            select(func.count()).select_from(DocumentRecord).where(
                DocumentRecord.tenant_id == organization.organization_id,
                DocumentRecord.deleted_at.is_(None),
            )
        )
        held_job_count = await session.scalar(
            select(func.count()).select_from(IngestionJobRecord).where(
                IngestionJobRecord.tenant_id == organization.organization_id,
                IngestionJobRecord.state == "held_for_compute",
            )
        )
        result.append({
            "organization_id": organization.organization_id,
            "name": organization.name,
            "slug": organization.slug,
            "active": organization.active,
            "created_at": organization.created_at,
            "user_count": len(members),
            "active_user_count": sum(1 for member in members if member["active"]),
            "document_count": document_count or 0,
            "held_job_count": held_job_count or 0,
            "users": members,
        })
    return result


@router.get("/chat-responses")
async def list_chat_responses(
    status: str = "pending",
    limit: int = 50,
    _: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, object]]:
    if status not in {"pending", "evaluated", "all"}:
        raise HTTPException(status_code=422, detail="Status must be pending, evaluated, or all")
    if not 1 <= limit <= 100:
        raise HTTPException(status_code=422, detail="Limit must be between 1 and 100")

    statement = (
        select(ChatMessageRecord, ChatSessionRecord, OrganizationRecord, UserRecord, ChatResponseEvaluationRecord)
        .join(ChatSessionRecord, ChatSessionRecord.chat_id == ChatMessageRecord.chat_id)
        .join(OrganizationRecord, OrganizationRecord.organization_id == ChatSessionRecord.tenant_id)
        .join(UserRecord, UserRecord.user_id == ChatSessionRecord.user_id)
        .outerjoin(ChatResponseEvaluationRecord, ChatResponseEvaluationRecord.response_message_id == ChatMessageRecord.message_id)
        .where(ChatMessageRecord.role == "assistant")
        .order_by(ChatMessageRecord.created_at.desc(), ChatMessageRecord.message_id.desc())
        .limit(limit)
    )
    if status == "pending":
        statement = statement.where(ChatResponseEvaluationRecord.evaluation_id.is_(None))
    elif status == "evaluated":
        statement = statement.where(ChatResponseEvaluationRecord.evaluation_id.is_not(None))

    rows = (await session.execute(statement)).all()
    result = []
    for response, chat, organization, user, evaluation in rows:
        question = await session.scalar(
            select(ChatMessageRecord)
            .where(
                ChatMessageRecord.chat_id == chat.chat_id,
                ChatMessageRecord.role == "user",
                ChatMessageRecord.created_at <= response.created_at,
            )
            .order_by(ChatMessageRecord.created_at.desc(), ChatMessageRecord.message_id.desc())
            .limit(1)
        )
        scores = None if evaluation is None else {
            "correctness": evaluation.correctness,
            "relevance": evaluation.relevance,
            "clarity": evaluation.clarity,
            "overall": round((evaluation.correctness + evaluation.relevance + evaluation.clarity) / 3, 1),
            "notes": evaluation.notes,
            "evaluator_user_id": evaluation.evaluator_user_id,
            "updated_at": evaluation.updated_at,
        }
        result.append({
            "response_message_id": response.message_id,
            "chat_id": chat.chat_id,
            "chat_title": chat.title,
            "organization_id": organization.organization_id,
            "organization_name": organization.name,
            "user_id": user.user_id,
            "user_name": user.display_name,
            "question": question.content if question else "Question unavailable",
            "answer": response.content,
            "created_at": response.created_at,
            "evaluation": scores,
        })
    return result


@router.put("/chat-responses/{response_message_id}/evaluation")
async def evaluate_chat_response(
    response_message_id: str,
    payload: ResponseEvaluationUpdate,
    principal: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    response = await session.get(ChatMessageRecord, response_message_id)
    if response is None or response.role != "assistant":
        raise HTTPException(status_code=404, detail="Assistant response not found")
    evaluation = await session.scalar(
        select(ChatResponseEvaluationRecord).where(ChatResponseEvaluationRecord.response_message_id == response_message_id)
    )
    if evaluation is None:
        evaluation = ChatResponseEvaluationRecord(
            evaluation_id=str(uuid4()),
            response_message_id=response_message_id,
            evaluator_user_id=principal.user_id,
            **payload.model_dump(),
        )
        session.add(evaluation)
    else:
        evaluation.evaluator_user_id = principal.user_id
        evaluation.correctness = payload.correctness
        evaluation.relevance = payload.relevance
        evaluation.clarity = payload.clarity
        evaluation.notes = payload.notes
        evaluation.updated_at = datetime.now(UTC)
    await session.commit()
    chat = await session.get(ChatSessionRecord, response.chat_id)
    await record(
        session,
        "platform_chat_response_evaluated",
        chat.tenant_id if chat else principal.tenant_id,
        principal.user_id,
        response_message_id=response_message_id,
        correctness=payload.correctness,
        relevance=payload.relevance,
        clarity=payload.clarity,
    )
    return {"status": "evaluated", "overall": round((payload.correctness + payload.relevance + payload.clarity) / 3, 1)}


async def membership_and_user(session: AsyncSession, user_id: str) -> tuple[MembershipRecord, UserRecord]:
    row = (await session.execute(
        select(MembershipRecord, UserRecord)
        .join(UserRecord, UserRecord.user_id == MembershipRecord.user_id)
        .where(MembershipRecord.user_id == user_id)
    )).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    return row


async def ensure_active_admin_remains(session: AsyncSession, membership: MembershipRecord) -> None:
    if membership.role != "admin":
        return
    count = await session.scalar(
        select(func.count()).select_from(MembershipRecord).join(UserRecord).where(
            MembershipRecord.organization_id == membership.organization_id,
            MembershipRecord.role == "admin",
            UserRecord.active.is_(True),
        )
    )
    if (count or 0) <= 1:
        raise HTTPException(status_code=409, detail="The final active organization administrator cannot be changed")


async def revoke_user_sessions(session: AsyncSession, user: UserRecord) -> None:
    now = datetime.now(UTC)
    user.token_version += 1
    await session.execute(
        update(RefreshSessionRecord)
        .where(RefreshSessionRecord.user_id == user.user_id, RefreshSessionRecord.revoked_at.is_(None))
        .values(revoked_at=now)
    )


@router.patch("/organizations/{organization_id}/status")
async def set_organization_status(
    organization_id: str,
    payload: StatusUpdate,
    principal: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    organization = await session.get(OrganizationRecord, organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    organization.active = payload.active
    if not payload.active:
        users = list(await session.scalars(
            select(UserRecord).join(MembershipRecord).where(
                MembershipRecord.organization_id == organization_id,
                UserRecord.is_super_admin.is_(False),
            )
        ))
        for user in users:
            await revoke_user_sessions(session, user)
    await session.commit()
    await record(
        session,
        "platform_organization_activated" if payload.active else "platform_organization_suspended",
        organization_id,
        principal.user_id,
    )
    return {"status": "active" if payload.active else "suspended"}


@router.patch("/users/{user_id}/status")
async def set_user_status(
    user_id: str,
    payload: StatusUpdate,
    principal: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    membership, user = await membership_and_user(session, user_id)
    if not payload.active:
        if user.user_id == principal.user_id:
            raise HTTPException(status_code=409, detail="A super administrator cannot deactivate their own account")
        await ensure_active_admin_remains(session, membership)
        if user.is_super_admin:
            active_super_admins = await session.scalar(
                select(func.count()).select_from(UserRecord).where(UserRecord.is_super_admin.is_(True), UserRecord.active.is_(True))
            )
            if (active_super_admins or 0) <= 1:
                raise HTTPException(status_code=409, detail="The final active super administrator cannot be deactivated")
    user.active = payload.active
    await revoke_user_sessions(session, user)
    await session.commit()
    await record(
        session,
        "platform_user_activated" if payload.active else "platform_user_deactivated",
        membership.organization_id,
        principal.user_id,
        target_user_id=user_id,
    )
    return {"status": "active" if payload.active else "deactivated"}


@router.patch("/users/{user_id}/role")
async def set_user_role(
    user_id: str,
    payload: PlatformRoleUpdate,
    principal: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    membership, user = await membership_and_user(session, user_id)
    if membership.role == "admin" and payload.role != "admin" and user.active:
        await ensure_active_admin_remains(session, membership)
    membership.role = payload.role
    await revoke_user_sessions(session, user)
    await session.commit()
    await record(
        session,
        "platform_user_role_changed",
        membership.organization_id,
        principal.user_id,
        target_user_id=user_id,
        role=payload.role,
    )
    return {"status": "updated"}


@router.post("/users/{user_id}/revoke-sessions")
async def revoke_sessions(
    user_id: str,
    principal: Principal = Depends(super_principal),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    membership, user = await membership_and_user(session, user_id)
    await revoke_user_sessions(session, user)
    await session.commit()
    await record(
        session,
        "platform_user_sessions_revoked",
        membership.organization_id,
        principal.user_id,
        target_user_id=user_id,
    )
    return {"status": "revoked"}
