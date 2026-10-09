import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import HTTPException

from app import main
from app.conversation import bounded_history
from app.models import Principal, QueryRequest
from app.providers import ModelClient


def message(role, content):
    return SimpleNamespace(role=role, content=content)


def test_history_is_bounded_chronological_and_never_truncated():
    messages = [message("user", "old"), message("assistant", "12345"), message("user", "new")]
    assert bounded_history(messages, 8) == [
        {"role": "assistant", "content": "12345"}, {"role": "user", "content": "new"},
    ]
    assert bounded_history(messages, 2) == []
    assert bounded_history([message("system", "override")], 100) == []


@pytest.mark.asyncio
async def test_new_chat_never_loads_history(monkeypatch):
    get = AsyncMock()
    monkeypatch.setattr(main, "get_chat", get)
    assert await main.conversation_history(QueryRequest(question="Hello there"), Principal(tenant_id="a", user_id="b", roles=[]), MagicMock()) == []
    get.assert_not_awaited()


@pytest.mark.asyncio
async def test_foreign_chat_rejected_before_history_read(monkeypatch):
    get = AsyncMock(return_value=None)
    load = AsyncMock()
    monkeypatch.setattr(main, "get_chat", get)
    monkeypatch.setattr(main, "list_recent_chat_messages", load)
    principal = Principal(tenant_id="tenant-a", user_id="user-a", roles=[])
    payload = QueryRequest(question="Explain point two", chat_id="a" * 36)
    session = MagicMock()
    with pytest.raises(HTTPException) as error:
        await main.conversation_history(payload, principal, session)
    assert error.value.status_code == 404
    get.assert_awaited_once_with(session, "tenant-a", "user-a", payload.chat_id)
    load.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("has_sources", [False, True])
async def test_follow_up_memory_and_acl_retrieval_in_both_endpoints(monkeypatch, streaming, has_sources):
    principal = Principal(tenant_id="tenant-a", user_id="user-a", roles=["member"])
    chat = SimpleNamespace(chat_id="a" * 36, title="Fees")
    history = [{"role": "user", "content": "What are the fees?"}, {"role": "assistant", "content": "1. Annual fee. 2. Late fee."}]
    payload = QueryRequest(question="Explain point two", chat_id=chat.chat_id)
    session = MagicMock()
    monkeypatch.setattr(main, "require_active_trial", lambda *_: None)
    monkeypatch.setattr(main, "require_compute_for_query", lambda: None)
    monkeypatch.setattr(main, "get_chat", AsyncMock(return_value=chat))
    monkeypatch.setattr(main, "list_recent_chat_messages", AsyncMock(return_value=[message(item["role"], item["content"]) for item in history]))
    monkeypatch.setattr(main, "reserve_question_trial_slot", AsyncMock())
    add = AsyncMock()
    monkeypatch.setattr(main, "add_chat_message", add)
    monkeypatch.setattr(main, "record", AsyncMock())
    rewrite = AsyncMock(return_value="Explain the late fee")
    embed = AsyncMock(return_value=[[0.1]])
    search = AsyncMock(return_value=[SimpleNamespace(payload={"text": "The late fee is INR 100."})] if has_sources else [])
    answer = AsyncMock(return_value="The late fee is INR 100.")
    streamed_calls = []

    async def answer_stream(*args):
        streamed_calls.append(args)
        yield "The late fee is INR 100."

    monkeypatch.setattr(main.model_server, "resolve_follow_up", rewrite)
    monkeypatch.setattr(main.model_server, "embed", embed)
    monkeypatch.setattr(main.model_server, "answer", answer)
    monkeypatch.setattr(main.model_server, "answer_stream", answer_stream)
    monkeypatch.setattr(main.vectors, "search", search)
    if streaming:
        response = await main.stream_query_documents(payload, principal, session)
        events = [event async for event in response.body_iterator]
        assert events
    else:
        await main.query_documents(payload, principal, session)
    rewrite.assert_awaited_once_with(payload.question, history)
    embed.assert_awaited_once_with(["Explain the late fee"])
    search.assert_awaited_once_with(principal, [0.1], payload.top_k)
    if has_sources:
        expected = (payload.question, "[Source 1] The late fee is INR 100.", history)
        if streaming:
            assert streamed_calls == [expected]
        else:
            answer.assert_awaited_once_with(*expected)
    else:
        answer.assert_not_awaited()
        assert not streamed_calls
        assert "not have enough information" in add.await_args.args[3]
    assert add.await_args_list[0].args == (session, chat, "user", payload.question)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 503])
async def test_rewrite_uses_untrusted_data_and_falls_back_on_failure(monkeypatch, status):
    captured = []

    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(status, json={"choices": [{"message": {"content": "Explain the late fee"}}]})

    client_class = httpx.AsyncClient
    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **kwargs: client_class(**kwargs, transport=httpx.MockTransport(handler)))
    history = [{"role": "assistant", "content": "Late fee is second."}]
    result = await ModelClient().resolve_follow_up("Explain point two", history)
    assert result == ("Explain the late fee" if status == 200 else "Explain point two")
    assert captured[0]["messages"][0]["role"] == "system"
    assert "Do not answer" in captured[0]["messages"][0]["content"]


def test_generation_keeps_history_separate_from_current_evidence():
    history = [{"role": "assistant", "content": "An old answer"}]
    for_history = ModelClient._answer_messages("Explain that", "Current source", history)
    assert for_history[0]["role"] == "system"
    assert "not verified evidence" in for_history[0]["content"]
    assert for_history[1] == history[0]
    assert "Current source" in for_history[-1]["content"]


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_history_is_sent_to_model_in_both_generation_modes(monkeypatch, streaming):
    captured = []

    def handler(request):
        captured.append(json.loads(request.content))
        if streaming:
            return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"Grounded answer"}}]}\n\ndata: [DONE]\n\n')
        return httpx.Response(200, json={"choices": [{"message": {"content": "Grounded answer"}}]})

    client_class = httpx.AsyncClient
    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **kwargs: client_class(**kwargs, transport=httpx.MockTransport(handler)))
    model = ModelClient()
    history = [{"role": "user", "content": "Original question"}, {"role": "assistant", "content": "Original answer"}]
    if streaming:
        assert "".join([part async for part in model.answer_stream("Explain that", "Source", history)]) == "Grounded answer"
    else:
        assert await model.answer("Explain that", "Source", history) == "Grounded answer"
    assert captured[0]["messages"][1:3] == history
    assert captured[0]["messages"][0]["role"] == "system"


@pytest.mark.asyncio
async def test_disabled_memory_does_not_read_messages(monkeypatch):
    monkeypatch.setattr(main, "get_chat", AsyncMock(return_value=SimpleNamespace(chat_id="a" * 36)))
    monkeypatch.setattr(main, "get_settings", lambda: SimpleNamespace(chat_memory_messages=0, chat_memory_characters=8000))
    load = AsyncMock()
    monkeypatch.setattr(main, "list_recent_chat_messages", load)
    result = await main.conversation_history(QueryRequest(question="Explain point two", chat_id="a" * 36), Principal(tenant_id="a", user_id="b", roles=[]), MagicMock())
    assert result == []
    load.assert_not_awaited()
