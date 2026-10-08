from io import BytesIO

import pytest
from fastapi import HTTPException
from pypdf import PdfWriter

from app.document_parser import count_document_pages
from app.providers import ModelClient


def pdf_bytes(pages=3, password=None):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    if password:
        writer.encrypt(password)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_exact_pdf_count_including_blank_pages():
    assert count_document_pages(pdf_bytes(), "application/pdf; charset=binary") == 3


@pytest.mark.parametrize("content", [b"broken", pdf_bytes(0), pdf_bytes(password="secret")])
def test_invalid_or_encrypted_pdf_cannot_be_metered(content):
    with pytest.raises(HTTPException) as error:
        count_document_pages(content, "application/pdf")
    assert error.value.status_code == 422


def test_non_paginated_formats_have_unknown_count():
    assert count_document_pages(b"hello", "text/plain") is None


def test_prompt_preserves_multilingual_and_financial_grounding():
    prompt = ModelClient._prompt("राजस्व कितना है?", "Revenue: INR 12 million")
    assert "language of the question" in prompt
    assert "Never treat missing or unclear values as zero" in prompt
    assert "राजस्व कितना है?" in prompt
