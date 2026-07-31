import argparse
import asyncio
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
from typing import Any, AsyncIterator, Awaitable, Callable
from urllib.parse import urlparse
from xml.etree import ElementTree

import httpx


PMC_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PMC_S3_URL = "https://pmc-oa-opendata.s3.amazonaws.com"
GOVINFO_API_URL = "https://api.govinfo.gov"
GOVINFO_CONTENT_URL = "https://www.govinfo.gov/content/pkg"
COMMERCIAL_PMC_LICENSES = {"CC0", "CC BY", "CC BY-SA", "CC BY-ND"}
PMC_QUERY = (
    "(cc0_license[filter] OR cc_by_license[filter] OR "
    "cc_by-sa_license[filter] OR cc_by-nd_license[filter]) "
    "AND open_access[filter] AND has_pdf[filter]"
)
SOURCE_HOSTS = {
    "pmc-oa-opendata.s3.amazonaws.com",
    "www.govinfo.gov",
}
PDF_CONTENT_TYPE = "application/pdf"
DEFAULT_MAX_BYTES = 25 * 1024 * 1024


class DatasetError(RuntimeError):
    pass


class CandidateRejected(DatasetError):
    pass


@dataclass(frozen=True)
class DatasetRecord:
    source: str
    identifier: str
    title: str
    license: str
    source_url: str
    file: str
    size_bytes: int
    sha256: str
    downloaded_at: str


@dataclass(frozen=True)
class IngestionRecord:
    file: str
    status: str
    document_id: str | None
    chunks_indexed: int | None
    detail: str | None
    attempted_at: str


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise DatasetError(f"Invalid JSON in {path} at line {line_number}") from error
        if not isinstance(value, dict):
            raise DatasetError(f"Expected a JSON object in {path} at line {line_number}")
        records.append(value)
    return records


def append_jsonl(path: Path, value: DatasetRecord | IngestionRecord) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as output:
        output.write(json.dumps(asdict(value), sort_keys=True) + "\n")
        output.flush()


def existing_dataset_records(output: Path) -> dict[tuple[str, str], DatasetRecord]:
    manifest = output / "manifest.jsonl"
    records: dict[tuple[str, str], DatasetRecord] = {}
    for value in load_jsonl(manifest):
        try:
            record = DatasetRecord(**value)
        except TypeError as error:
            raise DatasetError(f"Unexpected record in {manifest}") from error
        file_path = output / record.file
        if file_path.is_file() and file_path.stat().st_size == record.size_bytes:
            records[(record.source, record.identifier)] = record
    return records


def pmc_s3_to_https(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "s3" or parsed.netloc != "pmc-oa-opendata":
        raise CandidateRejected("PMC metadata returned an unexpected PDF location")
    return f"{PMC_S3_URL}/{parsed.path.lstrip('/')}" + (f"?{parsed.query}" if parsed.query else "")


def latest_pmc_prefix(xml: str, pmcid: str) -> str:
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise CandidateRejected("PMC returned invalid S3 listing XML") from error
    prefixes = [
        element.text.rstrip("/")
        for element in root.findall(".//{*}CommonPrefixes/{*}Prefix")
        if element.text and re.fullmatch(rf"{re.escape(pmcid)}\.\d+/", element.text)
    ]
    if not prefixes:
        raise CandidateRejected(f"No PMC article version found for {pmcid}")
    return max(prefixes, key=lambda value: int(value.rsplit(".", 1)[1]))


def safe_package_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
        raise CandidateRejected("GovInfo returned an invalid package identifier")
    return value


async def request_with_retries(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    attempts: int = 4,
) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = await client.get(url, params=params)
            if response.status_code == 429 or response.status_code >= 500:
                raise httpx.HTTPStatusError("Temporary upstream error", request=response.request, response=response)
            response.raise_for_status()
            return response
        except (httpx.HTTPError, OSError) as error:
            last_error = error
            if attempt + 1 == attempts:
                break
            await asyncio.sleep(min(2**attempt, 8))
    raise CandidateRejected(f"Unable to retrieve {url}") from last_error


async def download_pdf(
    client: httpx.AsyncClient,
    url: str,
    destination: Path,
    max_bytes: int,
) -> tuple[int, str]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in SOURCE_HOSTS:
        raise CandidateRejected("Refusing a PDF URL outside the approved source hosts")

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    temporary.unlink(missing_ok=True)
    digest = sha256()
    size = 0
    prefix = bytearray()

    try:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            if response.url.host not in SOURCE_HOSTS:
                raise CandidateRejected("PDF download redirected outside the approved source hosts")
            declared_size = response.headers.get("content-length")
            if declared_size and int(declared_size) > max_bytes:
                raise CandidateRejected(f"PDF exceeds the {max_bytes}-byte limit")
            with temporary.open("wb") as output:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > max_bytes:
                        raise CandidateRejected(f"PDF exceeds the {max_bytes}-byte limit")
                    if len(prefix) < 1024:
                        prefix.extend(chunk[: 1024 - len(prefix)])
                    digest.update(chunk)
                    output.write(chunk)
        if b"%PDF-" not in prefix:
            raise CandidateRejected("Downloaded content is not a PDF")
        temporary.replace(destination)
        return size, digest.hexdigest()
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


async def pmc_candidates(client: httpx.AsyncClient, count: int) -> list[str]:
    response = await request_with_retries(
        client,
        PMC_ESEARCH_URL,
        params={
            "db": "pmc",
            "term": PMC_QUERY,
            "retmode": "json",
            "retmax": min(10_000, max(1_000, count * 5)),
            "sort": "pub_date",
        },
    )
    try:
        identifiers = response.json()["esearchresult"]["idlist"]
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise DatasetError("PMC ESearch returned an invalid response") from error
    return [f"PMC{identifier}" for identifier in identifiers]


async def pmc_record(
    client: httpx.AsyncClient,
    output: Path,
    pmcid: str,
    max_bytes: int,
) -> DatasetRecord:
    listing = await request_with_retries(
        client,
        f"{PMC_S3_URL}/",
        params={"list-type": "2", "prefix": f"{pmcid}.", "delimiter": "/"},
    )
    prefix = latest_pmc_prefix(listing.text, pmcid)
    metadata_response = await request_with_retries(client, f"{PMC_S3_URL}/metadata/{prefix}.json")
    try:
        metadata = metadata_response.json()
    except json.JSONDecodeError as error:
        raise CandidateRejected(f"PMC returned invalid metadata for {pmcid}") from error

    license_code = metadata.get("license_code")
    if metadata.get("is_retracted") or not metadata.get("is_pmc_openaccess"):
        raise CandidateRejected(f"{pmcid} is not an eligible open-access article")
    if license_code not in COMMERCIAL_PMC_LICENSES:
        raise CandidateRejected(f"{pmcid} does not have an approved reusable license")
    pdf_url = metadata.get("pdf_url")
    if not isinstance(pdf_url, str):
        raise CandidateRejected(f"{pmcid} has no article PDF")

    destination = output / "pmc" / f"{prefix}.pdf"
    size, digest = await download_pdf(client, pmc_s3_to_https(pdf_url), destination, max_bytes)
    return DatasetRecord(
        source="pmc",
        identifier=pmcid,
        title=str(metadata.get("title") or metadata.get("citation") or pmcid),
        license=license_code,
        source_url=pmc_s3_to_https(pdf_url),
        file=str(destination.relative_to(output)),
        size_bytes=size,
        sha256=digest,
        downloaded_at=utc_now(),
    )


async def govinfo_candidates(
    client: httpx.AsyncClient,
    count: int,
    api_key: str,
    collection: str,
    start_date: str,
) -> list[str]:
    candidates: list[str] = []
    next_url: str | None = f"{GOVINFO_API_URL}/collections/{collection}/{start_date}"
    params: dict[str, Any] | None = {
        "pageSize": min(1_000, max(100, count * 3)),
        "offsetMark": "*",
        "api_key": api_key,
    }
    while next_url and len(candidates) < count * 3:
        response = await request_with_retries(client, next_url, params=params)
        params = {"api_key": api_key}
        try:
            payload = response.json()
            packages = payload["packages"]
        except (KeyError, TypeError, json.JSONDecodeError) as error:
            raise DatasetError("GovInfo returned an invalid collection response") from error
        for package in packages:
            package_id = package.get("packageId")
            if isinstance(package_id, str):
                candidates.append(safe_package_id(package_id))
        next_value = payload.get("nextPage")
        next_url = next_value if isinstance(next_value, str) else None
    return candidates


async def govinfo_record(
    client: httpx.AsyncClient,
    output: Path,
    package_id: str,
    max_bytes: int,
) -> DatasetRecord:
    safe_id = safe_package_id(package_id)
    source_url = f"{GOVINFO_CONTENT_URL}/{safe_id}/pdf/{safe_id}.pdf"
    destination = output / "govinfo" / f"{safe_id}.pdf"
    size, digest = await download_pdf(client, source_url, destination, max_bytes)
    return DatasetRecord(
        source="govinfo",
        identifier=safe_id,
        title=safe_id,
        license="U.S. government publication; verify package-specific notices",
        source_url=source_url,
        file=str(destination.relative_to(output)),
        size_bytes=size,
        sha256=digest,
        downloaded_at=utc_now(),
    )


async def collect_source(
    source: str,
    candidates: list[str],
    required: int,
    existing: dict[tuple[str, str], DatasetRecord],
    manifest: Path,
    concurrency: int,
    worker: Callable[[str], Awaitable[DatasetRecord]],
) -> int:
    completed = sum(1 for record in existing.values() if record.source == source)
    if completed >= required:
        print(f"{source}: already has {completed}/{required} PDFs")
        return required

    queue = [candidate for candidate in candidates if (source, candidate) not in existing]
    semaphore = asyncio.Semaphore(concurrency)

    async def guarded(candidate: str) -> DatasetRecord:
        async with semaphore:
            return await worker(candidate)

    cursor = 0
    while completed < required and cursor < len(queue):
        batch_size = min(required - completed, concurrency * 2)
        batch = queue[cursor : cursor + batch_size]
        cursor += len(batch)
        results = await asyncio.gather(*(guarded(candidate) for candidate in batch), return_exceptions=True)
        for candidate, result in zip(batch, results, strict=True):
            if isinstance(result, Exception):
                print(f"{source}: skipped {candidate}: {result}", file=sys.stderr)
                continue
            append_jsonl(manifest, result)
            existing[(result.source, result.identifier)] = result
            completed += 1
            print(f"{source}: {completed}/{required} {result.file}")

    if completed < required:
        raise DatasetError(
            f"{source}: downloaded {completed}/{required} PDFs; rerun to resume or broaden the source settings"
        )
    return completed


async def download_dataset(args: argparse.Namespace) -> None:
    if args.pmc_count < 0 or args.govinfo_count < 0:
        raise DatasetError("Source counts cannot be negative")
    if args.pmc_count + args.govinfo_count == 0:
        raise DatasetError("At least one source count must be positive")
    if args.concurrency < 1:
        raise DatasetError("Concurrency must be at least one")
    if args.max_bytes < 1:
        raise DatasetError("Maximum PDF size must be positive")
    if args.govinfo_count and not args.govinfo_api_key:
        raise DatasetError("Set GOVINFO_API_KEY when downloading GovInfo PDFs")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "manifest.jsonl"
    existing = existing_dataset_records(output)
    timeout = httpx.Timeout(connect=20, read=180, write=30, pool=30)
    limits = httpx.Limits(max_connections=max(args.concurrency * 2, 10), max_keepalive_connections=10)

    async with httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        follow_redirects=True,
        headers={"User-Agent": "secure-document-rag-dataset/1.0"},
    ) as client:
        if args.pmc_count:
            pmc_ids = await pmc_candidates(client, args.pmc_count)
            await collect_source(
                "pmc",
                pmc_ids,
                args.pmc_count,
                existing,
                manifest,
                args.concurrency,
                lambda pmcid: pmc_record(client, output, pmcid, args.max_bytes),
            )
        if args.govinfo_count:
            govinfo_ids = await govinfo_candidates(
                client,
                args.govinfo_count,
                args.govinfo_api_key,
                args.govinfo_collection,
                args.govinfo_start_date,
            )
            await collect_source(
                "govinfo",
                govinfo_ids,
                args.govinfo_count,
                existing,
                manifest,
                args.concurrency,
                lambda package_id: govinfo_record(client, output, package_id, args.max_bytes),
            )

    total = args.pmc_count + args.govinfo_count
    print(f"Dataset ready: {total} PDFs in {output}")
    print(f"Manifest: {manifest}")


async def file_content(path: Path) -> AsyncIterator[bytes]:
    with path.open("rb") as source:
        while chunk := await asyncio.to_thread(source.read, 1024 * 1024):
            yield chunk


def completed_ingestions(state_path: Path) -> set[str]:
    return {
        str(record["file"])
        for record in load_jsonl(state_path)
        if record.get("status") in {"indexed", "duplicate"} and isinstance(record.get("file"), str)
    }


async def ingest_file(
    client: httpx.AsyncClient,
    api_url: str,
    tenant_id: str,
    api_key: str,
    path: Path,
    relative_path: str,
    roles: str | None,
    users: str | None,
) -> IngestionRecord:
    headers = {
        "X-API-Key": api_key,
        "X-Tenant-ID": tenant_id,
        "X-Document-Name": path.name,
        "Content-Type": PDF_CONTENT_TYPE,
    }
    if roles:
        headers["X-Allowed-Roles"] = roles
    if users:
        headers["X-Allowed-Users"] = users

    try:
        response = await client.post(
            f"{api_url.rstrip('/')}/v1/documents",
            headers=headers,
            content=file_content(path),
        )
        try:
            payload = response.json()
        except json.JSONDecodeError:
            payload = {}
        if response.status_code == 409:
            return IngestionRecord(relative_path, "duplicate", None, None, "Already indexed", utc_now())
        if response.is_error:
            detail = payload.get("detail") if isinstance(payload, dict) else None
            return IngestionRecord(
                relative_path,
                "failed",
                None,
                None,
                detail if isinstance(detail, str) else f"HTTP {response.status_code}",
                utc_now(),
            )
        return IngestionRecord(
            relative_path,
            "indexed",
            payload.get("document_id"),
            payload.get("chunks_indexed"),
            None,
            utc_now(),
        )
    except httpx.HTTPError as error:
        return IngestionRecord(relative_path, "failed", None, None, str(error), utc_now())


async def ingest_dataset(args: argparse.Namespace) -> None:
    if not args.tenant_id:
        raise DatasetError("Set RAG_TENANT_ID or pass --tenant-id")
    if not args.api_key:
        raise DatasetError("Set RAG_API_KEY; API keys are intentionally not accepted as command-line arguments")
    if args.concurrency < 1:
        raise DatasetError("Concurrency must be at least one")
    if args.limit is not None and args.limit < 1:
        raise DatasetError("Limit must be at least one")
    if args.timeout <= 0:
        raise DatasetError("Timeout must be positive")

    input_path = args.input.resolve()
    manifest = input_path / "manifest.jsonl"
    if not manifest.is_file():
        raise DatasetError(f"Dataset manifest not found: {manifest}")
    dataset_records = [DatasetRecord(**record) for record in load_jsonl(manifest)]
    state_path = input_path / "ingestion-state.jsonl"
    completed = completed_ingestions(state_path)
    pending = [record for record in dataset_records if record.file not in completed]
    if args.limit is not None:
        pending = pending[: args.limit]
    if not pending:
        print("No PDFs are pending ingestion")
        return

    timeout = httpx.Timeout(connect=20, read=args.timeout, write=args.timeout, pool=30)
    semaphore = asyncio.Semaphore(args.concurrency)
    state_lock = asyncio.Lock()
    counters = {"indexed": 0, "duplicate": 0, "failed": 0}

    async with httpx.AsyncClient(timeout=timeout) as client:
        readiness = await client.get(f"{args.api_url.rstrip('/')}/readyz")
        if readiness.is_error:
            raise DatasetError(f"RAG API is not ready: HTTP {readiness.status_code}")

        async def process(record: DatasetRecord) -> None:
            path = input_path / record.file
            if not path.is_file():
                result = IngestionRecord(record.file, "failed", None, None, "File is missing", utc_now())
            else:
                async with semaphore:
                    result = await ingest_file(
                        client,
                        args.api_url,
                        args.tenant_id,
                        args.api_key,
                        path,
                        record.file,
                        args.roles,
                        args.users,
                    )
            async with state_lock:
                append_jsonl(state_path, result)
                counters[result.status] += 1
                finished = sum(counters.values())
                print(f"ingest: {finished}/{len(pending)} {result.status} {record.file}")
                if result.detail and result.status == "failed":
                    print(f"  {result.detail}", file=sys.stderr)

        await asyncio.gather(*(process(record) for record in pending))

    print(
        "Ingestion complete: "
        f"{counters['indexed']} indexed, {counters['duplicate']} duplicates, {counters['failed']} failed"
    )
    print(f"State: {state_path}")
    if counters["failed"]:
        raise DatasetError("Some documents failed; rerun the command to retry them")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rag-dataset",
        description="Download and index a licensed PDF corpus for Secure Document RAG.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    download = subparsers.add_parser("download", help="Download a resumable mixed PDF corpus")
    download.add_argument("--output", type=Path, default=Path("datasets/rag-500"))
    download.add_argument("--pmc-count", type=int, default=300)
    download.add_argument("--govinfo-count", type=int, default=200)
    download.add_argument("--govinfo-collection", default="BILLS")
    download.add_argument("--govinfo-start-date", default="2025-01-01T00:00:00Z")
    download.add_argument("--concurrency", type=int, default=6)
    download.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    download.set_defaults(
        handler=download_dataset,
        govinfo_api_key=os.getenv("GOVINFO_API_KEY", "DEMO_KEY"),
    )

    ingest = subparsers.add_parser("ingest", help="Batch-index a downloaded corpus")
    ingest.add_argument("--input", type=Path, default=Path("datasets/rag-500"))
    ingest.add_argument("--api-url", default=os.getenv("RAG_API_URL", "http://127.0.0.1:8080"))
    ingest.add_argument("--tenant-id", default=os.getenv("RAG_TENANT_ID"))
    ingest.add_argument("--api-key", dest="api_key", default=os.getenv("RAG_API_KEY"), help=argparse.SUPPRESS)
    ingest.add_argument("--roles")
    ingest.add_argument("--users")
    ingest.add_argument("--concurrency", type=int, default=1)
    ingest.add_argument("--limit", type=int)
    ingest.add_argument("--timeout", type=float, default=600)
    ingest.set_defaults(handler=ingest_dataset)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        asyncio.run(args.handler(args))
    except (DatasetError, httpx.HTTPError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
