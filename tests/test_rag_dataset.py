from pathlib import Path

import pytest

from tools.rag_dataset import (
    CandidateRejected,
    DatasetRecord,
    existing_dataset_records,
    latest_pmc_prefix,
    pmc_s3_to_https,
    safe_package_id,
)


def test_pmc_s3_url_is_converted_to_approved_https() -> None:
    value = pmc_s3_to_https(
        "s3://pmc-oa-opendata/PMC12855588.1/PMC12855588.1.pdf?md5=abc123"
    )

    assert value == (
        "https://pmc-oa-opendata.s3.amazonaws.com/"
        "PMC12855588.1/PMC12855588.1.pdf?md5=abc123"
    )


def test_pmc_s3_url_rejects_unapproved_bucket() -> None:
    with pytest.raises(CandidateRejected):
        pmc_s3_to_https("s3://example/PMC1.1/PMC1.1.pdf")


def test_latest_pmc_prefix_selects_highest_version() -> None:
    xml = """
    <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <CommonPrefixes><Prefix>PMC123.1/</Prefix></CommonPrefixes>
      <CommonPrefixes><Prefix>PMC123.3/</Prefix></CommonPrefixes>
      <CommonPrefixes><Prefix>PMC123.2/</Prefix></CommonPrefixes>
    </ListBucketResult>
    """

    assert latest_pmc_prefix(xml, "PMC123") == "PMC123.3"


def test_govinfo_package_id_validation() -> None:
    assert safe_package_id("BILLS-119hr1234ih") == "BILLS-119hr1234ih"
    with pytest.raises(CandidateRejected):
        safe_package_id("../../secret")


def test_existing_manifest_ignores_missing_files(tmp_path: Path) -> None:
    present = tmp_path / "pmc" / "PMC1.1.pdf"
    present.parent.mkdir()
    present.write_bytes(b"%PDF-test")
    manifest = tmp_path / "manifest.jsonl"
    records = [
        DatasetRecord(
            source="pmc",
            identifier="PMC1",
            title="One",
            license="CC BY",
            source_url="https://example.invalid/one.pdf",
            file="pmc/PMC1.1.pdf",
            size_bytes=9,
            sha256="one",
            downloaded_at="2026-01-01T00:00:00+00:00",
        ),
        DatasetRecord(
            source="pmc",
            identifier="PMC2",
            title="Two",
            license="CC BY",
            source_url="https://example.invalid/two.pdf",
            file="pmc/PMC2.1.pdf",
            size_bytes=9,
            sha256="two",
            downloaded_at="2026-01-01T00:00:00+00:00",
        ),
    ]
    manifest.write_text(
        "\n".join(__import__("json").dumps(record.__dict__) for record in records) + "\n",
        encoding="utf-8",
    )

    existing = existing_dataset_records(tmp_path)

    assert list(existing) == [("pmc", "PMC1")]
