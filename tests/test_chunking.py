from app.chunking import chunk_text


def test_chunking_preserves_all_content() -> None:
    text = "alpha " * 1_000
    chunks = chunk_text(text, chunk_size=100, overlap=20)
    assert len(chunks) > 1
    assert all(chunk for chunk in chunks)
    assert chunks[0].startswith("alpha")


def test_chunking_rejects_blank_text() -> None:
    assert chunk_text(" \n\t ") == []
