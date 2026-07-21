from io import BytesIO

from docx import Document
from fastapi import HTTPException, status
from pypdf import PdfReader


def extract_text(content: bytes, content_type: str) -> str:
    try:
        if content_type.startswith("text/plain"):
            return content.decode("utf-8")
        if content_type.startswith("application/pdf"):
            reader = PdfReader(BytesIO(content))
            if reader.is_encrypted:
                raise ValueError("Encrypted PDF files are not supported")
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        if content_type.startswith("application/vnd.openxmlformats-officedocument.wordprocessingml.document"):
            return "\n".join(paragraph.text for paragraph in Document(BytesIO(content)).paragraphs)
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unable to parse document") from error
    raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Supported types: text/plain, PDF, DOCX")
