from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.models import Principal
from app.trials import (
    TRIAL_DAYS,
    TRIAL_QUESTION_DAILY_LIMIT,
    is_pdf,
    new_trial_window,
    require_active_trial,
    reserve_question_trial_slot,
    trial_payload,
    utc_day_window,
)


def principal(*, expires: datetime | None, super_admin: bool = False) -> Principal:
    return Principal(tenant_id="organization", user_id="user", roles=["admin"], is_super_admin=super_admin, trial_ends_at=expires)


def test_new_trial_is_exactly_seven_days():
    now = datetime(2026, 8, 19, 10, 30, tzinfo=UTC)
    started, ends = new_trial_window(now)
    assert started == now
    assert ends == now + timedelta(days=TRIAL_DAYS)


def test_pdf_detection_uses_mime_type_or_filename():
    assert is_pdf("report.bin", "application/pdf; charset=binary")
    assert is_pdf("REPORT.PDF", "application/octet-stream")
    assert not is_pdf("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")


def test_expired_trial_is_rejected():
    with pytest.raises(Exception, match="trial has ended"):
        require_active_trial(principal(expires=datetime.now(UTC) - timedelta(seconds=1)))


def test_super_admin_bypasses_missing_trial():
    require_active_trial(principal(expires=None, super_admin=True))


def test_trial_payload_exposes_per_user_question_limit():
    now = datetime.now(UTC)
    payload = trial_payload(SimpleNamespace(trial_started_at=now, trial_ends_at=now + timedelta(days=1)))

    assert payload["question_daily_limit"] == TRIAL_QUESTION_DAILY_LIMIT
    assert trial_payload(SimpleNamespace(trial_started_at=now, trial_ends_at=now), is_super_admin=True)["question_daily_limit"] is None


def test_utc_day_window_resets_at_midnight():
    start, end = utc_day_window(datetime(2026, 8, 21, 23, 59, 59, tzinfo=UTC))

    assert start == datetime(2026, 8, 21, tzinfo=UTC)
    assert end == datetime(2026, 8, 22, tzinfo=UTC)


@pytest.mark.asyncio
async def test_question_limit_counts_only_current_user_and_utc_day():
    session = AsyncMock()
    session.scalar.side_effect = ["user", TRIAL_QUESTION_DAILY_LIMIT - 1]

    await reserve_question_trial_slot(
        session,
        principal(expires=datetime.now(UTC) + timedelta(days=1)),
        now=datetime(2026, 8, 21, 12, tzinfo=UTC),
    )

    statement = session.scalar.await_args_list[1].args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "chat_sessions.tenant_id = 'organization'" in sql
    assert "chat_sessions.user_id = 'user'" in sql
    assert "chat_messages.role = 'user'" in sql
    assert "2026-08-21 00:00:00+00:00" in sql
    assert "2026-08-22 00:00:00+00:00" in sql


@pytest.mark.asyncio
async def test_sixth_question_is_rejected():
    session = AsyncMock()
    session.scalar.side_effect = ["user", TRIAL_QUESTION_DAILY_LIMIT]

    with pytest.raises(HTTPException, match="at most 5 questions") as raised:
        await reserve_question_trial_slot(
            session,
            principal(expires=datetime.now(UTC) + timedelta(days=1)),
        )

    assert raised.value.status_code == 429


@pytest.mark.asyncio
async def test_super_admin_question_limit_bypasses_database_usage_check():
    session = AsyncMock()

    await reserve_question_trial_slot(session, principal(expires=None, super_admin=True))

    session.scalar.assert_not_awaited()
