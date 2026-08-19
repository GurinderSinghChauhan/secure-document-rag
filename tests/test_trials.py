from datetime import UTC, datetime, timedelta

import pytest

from app.models import Principal
from app.trials import TRIAL_DAYS, is_pdf, new_trial_window, require_active_trial


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
