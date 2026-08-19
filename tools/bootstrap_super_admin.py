"""Promote an existing verified account to platform super administrator."""

import asyncio
from datetime import UTC, datetime
from getpass import getpass

from sqlalchemy import select, update

from app.audit import record
from app.auth import normalize_email, verify_password
from app.database import MembershipRecord, RefreshSessionRecord, SessionFactory, UserRecord


async def bootstrap() -> None:
    email = normalize_email(input("Existing account email: "))
    password = getpass("Account password: ")
    confirmation = input("Type PROMOTE to grant platform-wide access: ").strip()
    if confirmation != "PROMOTE":
        raise SystemExit("Promotion cancelled")

    async with SessionFactory() as session:
        user = await session.scalar(select(UserRecord).where(UserRecord.email == email))
        if user is None or not user.active or not user.email_verified or not verify_password(user.password_hash, password):
            raise SystemExit("Active verified account credentials were not accepted")
        membership = await session.scalar(select(MembershipRecord).where(MembershipRecord.user_id == user.user_id))
        if membership is None:
            raise SystemExit("Account has no organization membership")
        if user.is_super_admin:
            print("Account is already a super administrator.")
            return
        user.is_super_admin = True
        user.token_version += 1
        await session.execute(
            update(RefreshSessionRecord)
            .where(RefreshSessionRecord.user_id == user.user_id, RefreshSessionRecord.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        await session.commit()
        await record(session, "platform_super_admin_granted", membership.organization_id, user.user_id)
        print("Super administrator access granted. Sign in again to use the platform console.")


def main() -> None:
    asyncio.run(bootstrap())


if __name__ == "__main__":
    main()
