import pytest
from pydantic import ValidationError

from app.main import chat_title
from app.models import QueryRequest


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
