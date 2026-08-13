from io import BytesIO
import json
from pathlib import PurePosixPath
import re
from zipfile import BadZipFile, ZipFile

import httpx
from fastapi import HTTPException, status
from lxml import html

from .config import get_settings
from .document_parser import ParsedDocument, VisualAsset, normalize_visual, table_to_markdown


MINERU_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
HTML_TABLE_PATTERN = re.compile(r"<table\b[^>]*>.*?</table>", re.IGNORECASE | re.DOTALL)


def supports_mineru(content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip().lower() in MINERU_CONTENT_TYPES


def _safe_member_name(name: str) -> bool:
    path = PurePosixPath(name)
    return not path.is_absolute() and ".." not in path.parts


def _content_items(payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, list):
        return []
    items: list[dict[str, object]] = []
    for value in payload:
        if isinstance(value, dict):
            items.append(value)
        elif isinstance(value, list):
            items.extend(item for item in value if isinstance(item, dict))
    return items


def _flatten_text(value: object) -> list[str]:
    if isinstance(value, str):
        normalized = " ".join(value.split())
        return [normalized] if normalized else []
    if isinstance(value, list):
        return [text for item in value for text in _flatten_text(item)]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _flatten_text(item)]
    return []


def _visual_description(item: dict[str, object]) -> str:
    keys = (
        "content",
        "image_caption",
        "image_footnote",
        "chart_caption",
        "chart_footnote",
    )
    return "\n".join(text for key in keys for text in _flatten_text(item.get(key)))


def _html_table_rows(markup: str) -> list[list[str]]:
    table = html.fragment_fromstring(markup)
    rows: list[list[str]] = []
    spans: dict[int, tuple[int, str]] = {}
    for row_element in table.xpath(".//tr"):
        row: list[str] = []
        column = 0

        def fill_spans() -> None:
            nonlocal column
            while column in spans:
                remaining, value = spans[column]
                row.append(value)
                if remaining <= 1:
                    del spans[column]
                else:
                    spans[column] = (remaining - 1, value)
                column += 1

        for cell in row_element.xpath("./th|./td"):
            fill_spans()
            value = " ".join(cell.text_content().split())
            try:
                colspan = max(1, int(cell.get("colspan", "1")))
                rowspan = max(1, int(cell.get("rowspan", "1")))
            except ValueError:
                colspan = rowspan = 1
            for _ in range(colspan):
                row.append(value)
                if rowspan > 1:
                    spans[column] = (rowspan - 1, value)
                column += 1
        fill_spans()
        if any(row):
            rows.append(row)
    return rows


def normalize_html_tables(markdown: str, omit_tables: bool = False) -> str:
    table_number = 0

    def replace_table(match: re.Match[str]) -> str:
        nonlocal table_number
        table_number += 1
        if omit_tables:
            return f"[MinerU table {table_number} is transcribed from its extracted image below]"
        try:
            rows = _html_table_rows(match.group(0))
            return table_to_markdown(rows, f"MinerU table {table_number}")
        except (ValueError, TypeError):
            return " ".join(html.fromstring(match.group(0)).text_content().split())

    return HTML_TABLE_PATTERN.sub(replace_table, markdown)


def _parse_archive(
    content: bytes,
    max_visuals: int,
    max_output_bytes: int,
    visual_enrichment_min_characters: int = 80,
) -> ParsedDocument:
    try:
        with ZipFile(BytesIO(content)) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if len(members) > 5_000 or sum(member.file_size for member in members) > max_output_bytes:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="MinerU output exceeds configured safety limits",
                )
            if any(not _safe_member_name(member.filename) for member in members):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="MinerU returned an unsafe archive",
                )

            names = {member.filename for member in members}
            markdown_names = sorted(name for name in names if name.lower().endswith(".md"))
            raw_markdown = archive.read(markdown_names[0]).decode("utf-8") if markdown_names else ""

            content_list_names = sorted(
                name for name in names if name.lower().endswith("_content_list.json")
            )
            items: list[dict[str, object]] = []
            if content_list_names:
                items = _content_items(json.loads(archive.read(content_list_names[0])))

            table_count = sum(item.get("type") == "table" for item in items)
            has_table_images = any(
                item.get("type") == "table" and isinstance(item.get("img_path"), str)
                for item in items
            )
            markdown = normalize_html_tables(raw_markdown, omit_tables=has_table_images)
            image_references: list[tuple[str, str, str]] = []
            for item in items:
                item_type = str(item.get("type", ""))
                image_path = item.get("img_path")
                if item_type not in {"image", "chart", "table"} or not isinstance(image_path, str):
                    continue
                page = item.get("page_idx")
                page_label = int(page) + 1 if isinstance(page, int) else "unknown"
                image_references.append(
                    (
                        image_path,
                        f"MinerU {item_type}, page {page_label}",
                        "" if item_type == "table" else _visual_description(item),
                    )
                )

            if not image_references:
                image_references = [
                    (name, f"MinerU extracted visual {index}", "")
                    for index, name in enumerate(
                        sorted(name for name in names if "/images/" in f"/{name}"), start=1
                    )
                ]

            visuals: list[VisualAsset] = []
            visual_sections: list[str] = []
            described_visual_count = 0
            seen_paths: set[str] = set()
            for image_path, location, description in image_references:
                normalized_path = str(PurePosixPath(image_path))
                candidates = [normalized_path, *(name for name in names if name.endswith(f"/{normalized_path}"))]
                archive_path = next((candidate for candidate in candidates if candidate in names), None)
                if archive_path is None or archive_path in seen_paths:
                    continue
                seen_paths.add(archive_path)
                if description:
                    visual_sections.append(f"[Visual content: {location}]\n{description}")
                    described_visual_count += 1
                if len(description) >= visual_enrichment_min_characters or len(visuals) >= max_visuals:
                    continue
                visual = normalize_visual(
                    archive.read(archive_path),
                    location,
                    description_indexed=bool(description),
                )
                if visual:
                    visuals.append(visual)

            text_sections = [section for section in (markdown.strip(), *visual_sections) if section]
            return ParsedDocument(
                text="\n\n".join(text_sections),
                visuals=visuals,
                table_count=table_count,
                described_visual_count=described_visual_count,
            )
    except HTTPException:
        raise
    except (BadZipFile, UnicodeDecodeError, json.JSONDecodeError, KeyError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="MinerU returned an invalid parsing result",
        ) from error


class MinerUClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def parse(
        self,
        content: bytes,
        content_type: str,
        document_name: str,
        max_visuals: int,
    ) -> ParsedDocument:
        form = {
            "backend": self.settings.mineru_backend,
            "parse_method": "auto",
            "formula_enable": "true",
            "table_enable": "true",
            "return_md": "true",
            "return_content_list": "true",
            "return_images": "true",
            "return_original_file": "false",
            "response_format_zip": "true",
        }
        timeout = httpx.Timeout(self.settings.mineru_timeout_seconds, connect=10)
        try:
            async with httpx.AsyncClient(base_url=self.settings.mineru_url, timeout=timeout) as client:
                response = await client.post(
                    "/file_parse",
                    data=form,
                    files={"files": (document_name, content, content_type)},
                )
            if response.is_error:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="MinerU document parser is unavailable",
                )
            if len(response.content) > self.settings.mineru_max_output_bytes:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="MinerU output exceeds configured safety limits",
                )
            return _parse_archive(
                response.content,
                max_visuals=max_visuals,
                max_output_bytes=self.settings.mineru_max_output_bytes,
                visual_enrichment_min_characters=self.settings.mineru_visual_enrichment_min_characters,
            )
        except HTTPException:
            raise
        except httpx.HTTPError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="MinerU document parser is unavailable",
            ) from error

    async def is_ready(self) -> bool:
        try:
            async with httpx.AsyncClient(base_url=self.settings.mineru_url, timeout=5) as client:
                response = await client.get("/health")
            return response.is_success
        except httpx.HTTPError:
            return False
