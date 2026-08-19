from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import record
from .auth import require_principal, require_super_admin
from .database import (
    DocumentRecord,
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
