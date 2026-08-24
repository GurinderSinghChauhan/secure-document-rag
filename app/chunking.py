import re


INDEX_NOISE_PATTERN = re.compile(r"mineru", re.IGNORECASE)


def sanitize_index_text(text: str) -> str:
    """Remove parser branding that must never be persisted in searchable chunks."""
    sanitized = INDEX_NOISE_PATTERN.sub("", text)
    sanitized = re.sub(r"[ \t]+", " ", sanitized)
    sanitized = re.sub(r" *\n *", "\n", sanitized)
    return re.sub(r"\n{3,}", "\n\n", sanitized).strip()


def chunk_text(text: str, chunk_size: int = 1_200, overlap: int = 200) -> list[str]:
    normalized = " ".join(sanitize_index_text(text).split())
    if not normalized:
        return []
    if len(normalized) <= chunk_size:
        return [normalized]

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start, end)
            if boundary > start + chunk_size // 2:
                end = boundary
        chunks.append(normalized[start:end].strip())
        if end == len(normalized):
            break
        start = max(end - overlap, start + 1)
    return chunks
