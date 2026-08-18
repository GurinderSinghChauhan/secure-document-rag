"""Claim an existing organization with its first administrator."""
import argparse
import asyncio
from getpass import getpass
from uuid import uuid4

from sqlalchemy import func, or_, select

from app.auth import hash_password, normalize_email
from app.database import MembershipRecord, OrganizationRecord, SessionFactory, UserRecord


async def bootstrap(organization_ref: str) -> None:
    display_name = input("Administrator name: ").strip()
    email = normalize_email(input("Administrator email: "))
    password = getpass("Password (12-128 characters): ")
    confirmation = getpass("Confirm password: ")
    if len(display_name) < 2 or len(password) < 12 or len(password) > 128 or password != confirmation:
        raise SystemExit("Invalid name, password length, or confirmation")
    async with SessionFactory() as session:
        organization = await session.scalar(select(OrganizationRecord).where(or_(OrganizationRecord.organization_id == organization_ref, OrganizationRecord.slug == organization_ref)))
        if organization is None:
            raise SystemExit("Organization not found")
        member_count = await session.scalar(select(func.count()).select_from(MembershipRecord).where(MembershipRecord.organization_id == organization.organization_id))
        if member_count:
            raise SystemExit("Organization already has an account; use the admin UI")
        if await session.scalar(select(UserRecord).where(UserRecord.email == email)):
            raise SystemExit("Email is already registered")
        user = UserRecord(user_id=str(uuid4()), email=email, display_name=display_name, password_hash=hash_password(password), email_verified=True)
        session.add(user)
        await session.flush()
        session.add(MembershipRecord(membership_id=str(uuid4()), organization_id=organization.organization_id, user_id=user.user_id, role="admin"))
        await session.commit()
        print(f"Administrator created for {organization.name}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("organization", help="Existing organization ID or slug")
    args = parser.parse_args()
    asyncio.run(bootstrap(args.organization))


if __name__ == "__main__":
    main()
