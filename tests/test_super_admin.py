import pytest

from app.database import MembershipRecord, PlatformSettingsRecord, UserRecord
from app.models import Principal
from app.super_admin import (
    PlatformDisplaySettingsUpdate,
    ResponseEvaluationUpdate,
    StatusUpdate,
    get_display_settings,
    set_user_status,
    update_display_settings,
)


class RowResult:
    def __init__(self, row):
        self.row = row

    def one_or_none(self):
        return self.row


class SafetySession:
    def __init__(self, membership, user, count=1):
        self.membership = membership
        self.user = user
        self.count = count

    async def execute(self, _statement):
        return RowResult((self.membership, self.user))

    async def scalar(self, _statement):
        return self.count


class SettingsSession:
    def __init__(self, settings=None):
        self.settings = settings
        self.added = []
        self.commit_count = 0

    async def get(self, model, identifier):
        assert model is PlatformSettingsRecord
        assert identifier == "global"
        return self.settings

    def add(self, value):
        self.added.append(value)
        if isinstance(value, PlatformSettingsRecord):
            self.settings = value

    async def commit(self):
        self.commit_count += 1


def principal(user_id="platform-admin"):
    return Principal(tenant_id="platform-org", user_id=user_id, roles=["admin"], is_super_admin=True)


def membership(user_id, role="member"):
    return MembershipRecord(membership_id=f"membership-{user_id}", organization_id="target-org", user_id=user_id, role=role)


def user(user_id, *, super_admin=False):
    return UserRecord(
        user_id=user_id,
        email=f"{user_id}@example.com",
        display_name=user_id,
        password_hash="unused",
        email_verified=True,
        active=True,
        token_version=0,
        is_super_admin=super_admin,
    )


@pytest.mark.asyncio
async def test_super_admin_cannot_deactivate_self():
    actor = user("platform-admin", super_admin=True)
    session = SafetySession(membership(actor.user_id, "admin"), actor)

    with pytest.raises(Exception, match="cannot deactivate their own account"):
        await set_user_status(actor.user_id, StatusUpdate(active=False), principal(), session)


@pytest.mark.asyncio
async def test_super_admin_cannot_deactivate_final_organization_admin():
    target = user("organization-admin")
    session = SafetySession(membership(target.user_id, "admin"), target, count=1)

    with pytest.raises(Exception, match="final active organization administrator"):
        await set_user_status(target.user_id, StatusUpdate(active=False), principal(), session)


@pytest.mark.asyncio
async def test_super_admin_cannot_deactivate_final_platform_admin():
    target = user("other-platform-admin", super_admin=True)
    session = SafetySession(membership(target.user_id, "member"), target, count=1)

    with pytest.raises(Exception, match="final active super administrator"):
        await set_user_status(target.user_id, StatusUpdate(active=False), principal(), session)


def test_response_evaluation_enforces_rubric_range_and_normalizes_notes():
    evaluation = ResponseEvaluationUpdate(correctness=5, relevance=4, clarity=3, notes="  Missing citation.  ")

    assert evaluation.notes == "Missing citation."

    with pytest.raises(ValueError, match="between 1 and 5"):
        ResponseEvaluationUpdate(correctness=0, relevance=4, clarity=3)


def test_response_evaluation_rejects_oversized_notes():
    with pytest.raises(ValueError, match="2,000 characters"):
        ResponseEvaluationUpdate(correctness=5, relevance=4, clarity=3, notes="x" * 2_001)


@pytest.mark.asyncio
async def test_display_settings_default_off_and_persist_super_admin_update():
    session = SettingsSession()

    initial = await get_display_settings(principal(), session)
    updated = await update_display_settings(
        PlatformDisplaySettingsUpdate(show_classification_confidence=True),
        principal(),
        session,
    )

    assert initial.show_classification_confidence is False
    assert updated.show_classification_confidence is True
    assert session.settings.show_classification_confidence is True
    assert session.settings.updated_by == "platform-admin"
    assert session.commit_count == 2
