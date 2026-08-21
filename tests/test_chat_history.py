from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app import main
from app.main import chat_title
from app.models import Principal, QueryRequest
from app.repository import create_chat


def test_chat_title_normalizes_whitespace():
    assert chat_title("  What   are\n the obligations?  ") == "What are the obligations?"


def test_chat_title_truncates_long_questions():
    title = chat_title("x" * 100)

    assert len(title) == 80
    assert title.endswith("...")


def test_query_request_accepts_chat_id():
    chat_id = "12345678-1234-1234-1234-123456789012"

    assert QueryRequest(question="What changed?", chat_id=chat_id).chat_id == chat_id


def test_query_request_rejects_invalid_chat_id_length():
    with pytest.raises(ValidationError):
        QueryRequest(question="What changed?", chat_id="short")


@pytest.mark.asyncio
async def test_new_chat_is_flushed_without_committing_before_quota_reservation():
    session = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    await create_chat(session, "organization", "user", "Question")

    session.flush.assert_awaited_once()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_query_reserves_user_slot_before_committing_question(monkeypatch):
    calls = []
    chat = SimpleNamespace(chat_id="chat", title="Question")

    async def create(*_args):
        calls.append("create")
        return chat

    async def reserve(*_args):
        calls.append("reserve")

    async def add(*_args):
        calls.append("add")

    monkeypatch.setattr(main, "create_chat", create)
    monkeypatch.setattr(main, "reserve_question_trial_slot", reserve)
    monkeypatch.setattr(main, "add_chat_message", add)
    principal = Principal(
        tenant_id="organization",
        user_id="user",
        roles=["member"],
        trial_ends_at=datetime.now(UTC) + timedelta(days=1),
    )

    result = await main.resolve_chat(QueryRequest(question="What changed?"), principal, MagicMock())

    assert result is chat
    assert calls == ["create", "reserve", "add"]
