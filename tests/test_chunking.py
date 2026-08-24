from app.chunking import chunk_text, sanitize_index_text


def test_chunking_preserves_all_content() -> None:
    text = "alpha " * 1_000
    chunks = chunk_text(text, chunk_size=100, overlap=20)
    assert len(chunks) > 1
    assert all(chunk for chunk in chunks)
    assert chunks[0].startswith("alpha")


def test_chunking_rejects_blank_text() -> None:
    assert chunk_text(" \n\t ") == []


def test_sanitize_index_text_removes_parser_name_in_every_case() -> None:
    sanitized = sanitize_index_text(
        "[MinerU table 1]\nMINERU chart\nmineru-generated caption\npreMineruSuffix"
    )

    assert "mineru" not in sanitized.lower()
    assert "table 1" in sanitized
    assert "chart" in sanitized
    assert "caption" in sanitized


def test_chunking_never_emits_parser_name() -> None:
    chunks = chunk_text("Source text MinerU IMAGE mineru table preMINERUsuffix")

    assert chunks
    assert all("mineru" not in chunk.lower() for chunk in chunks)
