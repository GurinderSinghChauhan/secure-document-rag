# PDF Test Dataset

The dataset tool creates a reproducible, resumable corpus of 500 public PDFs and can batch-index it through the Secure Document RAG API.

## Default composition

| Source | Count | Content | Selection policy |
| --- | ---: | --- | --- |
| PubMed Central | 300 | Healthcare and biomedical articles | Open-access PDFs with CC0, CC BY, CC BY-SA, or CC BY-ND licenses |
| GovInfo | 200 | U.S. legislative documents | Official PDFs from the Congressional Bills collection |

The downloader uses the current PMC ESearch-to-S3 workflow rather than the legacy PMC FTP layout scheduled for removal in August 2026. GovInfo discovery uses its official API and downloads PDFs from permanent GovInfo content URLs.

Every successful download is written to `manifest.jsonl` with its source, identifier, title, license description, source URL, relative file path, byte size, SHA-256 checksum, and download timestamp.

The generated `datasets/` directory is ignored by Git.

## Download exactly 500 PDFs

From the project root:

```bash
uv sync
uv run python -m tools.rag_dataset download
```

The default output is:

```text
datasets/rag-500/
├── govinfo/
├── pmc/
└── manifest.jsonl
```

Downloads resume from the manifest. Existing files with the recorded size are not downloaded again. Files larger than the application's default 25 MB upload limit are skipped and replaced by another candidate.

GovInfo permits the shared `DEMO_KEY` for evaluation, but it is rate-limited. For a reliable 500-document run, request a free `api.data.gov` key and set:

```bash
export GOVINFO_API_KEY="your-api-data-gov-key"
uv run python -m tools.rag_dataset download
```

Useful download options:

```bash
uv run python -m tools.rag_dataset download --help
uv run python -m tools.rag_dataset download --pmc-count 500 --govinfo-count 0
uv run python -m tools.rag_dataset download --concurrency 4
uv run python -m tools.rag_dataset download --max-bytes 15728640
```

PMC license terms can contain article-specific conditions. The downloader restricts selection to machine-readable licenses that allow commercial reuse, but the organization running a test remains responsible for reviewing applicable terms.

## Batch ingestion

Start the RAG stack and model server, then export the development credentials for an administrator in the target tenant:

```bash
export RAG_API_URL="http://127.0.0.1:8080"
export RAG_TENANT_ID="acme-health"
export RAG_API_KEY="your-admin-api-key"
uv run python -m tools.rag_dataset ingest
```

API keys are accepted only through `RAG_API_KEY`; they are intentionally hidden from command-line arguments to reduce shell-history exposure.

The ingestion command:

- checks `/readyz` before starting;
- uploads PDF bodies without loading the entire file into memory;
- defaults to one concurrent upload to protect a small local GPU;
- records each attempt in `ingestion-state.jsonl`;
- treats HTTP `409` as an already-indexed document;
- retries failed documents when the command is run again.

Start with a small validation run:

```bash
uv run python -m tools.rag_dataset ingest --limit 5
```

Then run the remaining corpus:

```bash
uv run python -m tools.rag_dataset ingest
```

Increase concurrency only after observing model-server stability:

```bash
uv run python -m tools.rag_dataset ingest --concurrency 2
```

Optional ACLs can be applied to every document in a run:

```bash
uv run python -m tools.rag_dataset ingest \
  --roles "clinician,reviewer" \
  --users "test-user-1,test-user-2"
```

## Operational expectations

Downloading 500 PDFs can consume several gigabytes depending on document selection. Indexing is substantially slower because every document must be parsed, chunked, embedded, and written to Qdrant. On an 8 GB RTX 4060, begin with concurrency one and expect the complete indexing run to take hours rather than minutes.

This corpus tests text extraction and retrieval over real documents. It does not provide ground-truth questions, expected answers, relevance judgments, prompt-injection cases, or compliance certification. Those require a separate evaluation set.

## Official sources

- [PMC Open Access Subset](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/)
- [PMC AWS dataset access](https://pmc.ncbi.nlm.nih.gov/tools/pmcaws/)
- [GovInfo developer hub](https://www.govinfo.gov/developers)
- [GovInfo API introduction](https://www.govinfo.gov/features/api)
