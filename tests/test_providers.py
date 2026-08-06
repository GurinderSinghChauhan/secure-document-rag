import pytest
from fastapi import HTTPException

from app.document_parser import VisualAsset
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


@pytest.mark.asyncio
async def test_describe_visual_uses_configured_local_vision_model(monkeypatch):
    captured = {}

    class FakeResponse:
        is_error = False

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "A flowchart links intake to review."}}]}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, path, json):
            captured["path"] = path
            captured["payload"] = json
            return FakeResponse()

    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **_: FakeClient())
    client = ModelClient()

    description = await client.describe_visual(VisualAsset(b"image-bytes", "image/png", "PDF page 1"))

    assert description == "A flowchart links intake to review."
    assert captured["path"] == "/chat/completions"
    assert captured["payload"]["model"] == client.settings.vision_model
    image_url = captured["payload"]["messages"][0]["content"][1]["image_url"]["url"]
    assert image_url.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_embedding_requests_use_configured_batch_size(monkeypatch):
    batch_sizes = []

    class FakeResponse:
        is_error = False

        def __init__(self, size):
            self.size = size

        def json(self):
            return {"data": [{"index": index, "embedding": [float(index)]} for index in range(self.size)]}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, _path, json):
            batch_sizes.append(len(json["input"]))
            return FakeResponse(len(json["input"]))

    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **_: FakeClient())

    embeddings = await ModelClient().embed([f"chunk-{index}" for index in range(129)])

    assert batch_sizes == [128, 1]
    assert len(embeddings) == 129
