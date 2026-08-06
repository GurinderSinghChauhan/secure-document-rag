import base64
from io import BytesIO
import json
from zipfile import ZipFile

import httpx
import pytest

from app.mineru import MinerUClient, _parse_archive, supports_mineru


PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def mineru_archive(chart_content: str = "") -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("report/report.md", "# Risk report\n\n<table><tr><td>High</td></tr></table>")
        archive.writestr(
            "report/report_content_list.json",
            json.dumps(
                [
                    {"type": "text", "text": "Risk report", "page_idx": 0},
                    {"type": "table", "page_idx": 0},
                    {
                        "type": "chart",
                        "img_path": "images/chart.png",
                        "page_idx": 1,
                        "content": chart_content,
                    },
                ]
            ),
        )
        archive.writestr("report/images/chart.png", PNG_BYTES)
    return output.getvalue()


def test_parse_archive_extracts_markdown_tables_and_visuals():
    parsed = _parse_archive(mineru_archive(), max_visuals=10, max_output_bytes=1_000_000)

    assert "Risk report" in parsed.text
    assert parsed.table_count == 1
    assert len(parsed.visuals) == 1
    assert parsed.visuals[0].location == "MinerU chart, page 2"
    assert parsed.described_visual_count == 0


def test_parse_archive_skips_redundant_enrichment_for_detailed_visual_content():
    chart_content = "Quarterly liquidity risk increased from 18 percent to 34 percent across four reporting periods."

    parsed = _parse_archive(
        mineru_archive(chart_content),
        max_visuals=10,
        max_output_bytes=1_000_000,
    )

    assert chart_content in parsed.text
    assert parsed.visuals == []
    assert parsed.described_visual_count == 1


def test_parse_archive_enforces_visual_limit():
    parsed = _parse_archive(mineru_archive(), max_visuals=0, max_output_bytes=1_000_000)

    assert parsed.visuals == []


def test_supports_mineru_structured_document_types():
    assert supports_mineru("application/pdf")
    assert supports_mineru("application/pdf; charset=binary")
    assert not supports_mineru("text/plain")


@pytest.mark.asyncio
async def test_client_requests_offline_zip_result(monkeypatch):
    captured: dict[str, object] = {}

    class FakeResponse:
        is_error = False
        content = mineru_archive()

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, path, **kwargs):
            captured["path"] = path
            captured["request"] = kwargs
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    parsed = await MinerUClient().parse(b"pdf", "application/pdf", "report.pdf", 10)

    assert parsed.table_count == 1
    assert captured["path"] == "/file_parse"
    request = captured["request"]
    assert request["data"]["backend"] == "pipeline"
    assert request["data"]["response_format_zip"] == "true"
    assert request["files"]["files"] == ("report.pdf", b"pdf", "application/pdf")
