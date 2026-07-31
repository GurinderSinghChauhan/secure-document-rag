import pytest
from fastapi import HTTPException

from app.providers import ModelClient


def test_stream_content_returns_delta_text():
    line = 'data: {"choices":[{"delta":{"content":"First sentence."}}]}'

    assert ModelClient._stream_content(line) == "First sentence."


@pytest.mark.parametrize("line", ["", "event: message", "data: [DONE]", "data: "])
def test_stream_content_ignores_non_content_lines(line):
    assert ModelClient._stream_content(line) is None


def test_stream_content_rejects_invalid_payload():
    with pytest.raises(HTTPException) as error:
        ModelClient._stream_content("data: not-json")

    assert error.value.status_code == 502
