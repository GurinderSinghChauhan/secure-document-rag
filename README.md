# Secure Document RAG

Self-hosted, multi-tenant retrieval-augmented generation (RAG) for sensitive healthcare, legal, and financial documents. Documents, embeddings, vector search, and generation stay inside your controlled network.

## What this starter provides

- A self-hosted OpenAI-compatible model server for embeddings, visual understanding, and answer generation.
- A self-hosted **MinerU** service for layout-aware OCR, reading order, tables, formulas, and figure extraction.
- Self-hosted **Qdrant** for vector storage, with one collection per tenant.
- **PostgreSQL** system of record for document lifecycle and metadata-only audit events.
- FastAPI service with API-key authentication, tenant enforcement, document-level ACLs, bounded retrieval context, and readiness probes.
- Docker deployment that exposes the application only on `127.0.0.1` by default; PostgreSQL and Qdrant remain private to the Docker network, and LM Studio remains bound to the host.

This is an application foundation, not a compliance certification. HIPAA, GLBA, PCI DSS, SEC, GDPR, and legal-hold obligations require organization-specific controls, policies, reviews, and evidence.

## Documentation

- [Functional guide](docs/functional-guide.md): user roles, document lifecycle, expected behavior, and operational limitations.
- [Technical guide](docs/technical-guide.md): architecture, data flow, API contract, configuration, operations, and production gaps.
- [Design system](docs/design-system.md): visual tokens, accessible components, regulated workflows, privacy rules, and UI review criteria.
- [PDF test dataset](docs/test-dataset.md): download and batch-index a licensed 500-document healthcare and legal corpus.

## Quick start

```bash
cp .env.example .env
docker compose up --build -d
```

Before starting, replace the example `TENANT_API_KEYS_JSON` and `POSTGRES_PASSWORD` values in `.env`. The service refuses to start with an example API key. Use secrets supplied by your secret manager in real deployments; do not commit `.env`.

The first build creates the pinned, pipeline-only `mineru:3.2.1` CUDA image. A one-shot `mineru-models` service downloads only the pipeline weights into the persistent `mineru-models` volume before the private MinerU API starts. Image rebuilds therefore do not duplicate or re-download model weights. MinerU must remain configured with `MINERU_MODEL_SOURCE=local`; do not configure its hosted API for regulated documents. The model initialization follows MinerU's [local-model guidance](https://opendatalab.github.io/MinerU/usage/model_source/).

Multimodal ingestion requires an image-capable model exposed by LM Studio. Set `VISION_MODEL` to an identifier returned by `/v1/models`; readiness verifies the configured embedding, chat, and vision model IDs. The included MinerU service gives its `pipeline` backend access to NVIDIA GPU 0 by default and can be changed with `MINERU_GPU_DEVICE`. On an 8 GB RTX 4060, serialize heavy MinerU work and LM Studio model loading to avoid VRAM exhaustion; use a separate production GPU before switching MinerU to its VLM backend.

```bash
curl -X POST http://127.0.0.1:8080/v1/documents \
  -H 'X-API-Key: replace-with-a-real-secret' \
  -H 'X-Tenant-ID: acme-health' \
  -H 'X-Document-Name: policy.txt' \
  -H 'Content-Type: text/plain' \
  --data-binary @policy.txt

curl -X POST http://127.0.0.1:8080/v1/query \
  -H 'X-API-Key: replace-with-a-real-secret' \
  -H 'X-Tenant-ID: acme-health' \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is the retention period?"}'
```

## Security model

1. **Fail closed:** No default API key, tenant, or open CORS setting is accepted.
2. **Tenant boundary:** An API key is bound to exactly one tenant, and each tenant receives a distinct Qdrant collection.
3. **Document ACL:** Uploads can be restricted to roles and/or explicit users. Retrieval applies those filters before generation.
4. **No sensitive content in logs:** PostgreSQL audit records include only timestamps, actor/tenant IDs, action, and document IDs; queries and chunk text are never logged.
5. **Grounded responses:** The model is told to use only retrieved context. Retrieved sources remain internal and are not returned to the client.
6. **Private network:** PostgreSQL and Qdrant have no host port mappings. The model server remains on the host at `127.0.0.1:1234` and is reached only by the API container. Do not add telemetry, cloud fallback, or third-party observability exporters for regulated workloads without a reviewed data-flow assessment.
7. **Safe lifecycle:** Content is SHA-256 de-duplicated per tenant, tracked in PostgreSQL, and can be removed through an admin-only delete endpoint.

## Production hardening

- Terminate TLS at an internal gateway; enforce mTLS between gateway and API where required. Set `ALLOWED_HOSTS` to the gateway's hostname.
- Put volumes on encrypted storage; use KMS-managed keys and rotate API keys.
- Replace the environment key map with OIDC/JWT verification or your identity provider, retaining the tenant and role claims.
- Send audit events to immutable, access-controlled storage; set retention policies per regulation and legal hold.
- Add antivirus/DLP scanning and malware sandboxing before parsing uploads. Parser rejection is not a substitute for a malware-scanning pipeline.
- Use separate runtime identities, a secrets manager, network policies, backups, restore tests, vulnerability scanning, and model/image pinning.
- Validate retrieval isolation and prompt-injection resistance with adversarial tests before handling production records.

## API

`POST /v1/documents` ingests `text/plain`, PDF, DOCX, PPTX, XLSX, PNG, JPEG, or WebP request bodies. MinerU converts structured documents into Markdown and content-list JSON while extracting tables, formulas, images, charts, and layout metadata. Detailed MinerU visual content is indexed directly; only missing or short descriptions are concurrently enriched by the configured self-hosted vision model. Text embeddings use configurable large batches to reduce model-server round trips.

- `X-Document-Name` (required)
- `X-Allowed-Roles`: comma-separated role list
- `X-Allowed-Users`: comma-separated user IDs

`POST /v1/query` accepts `{ "question": "...", "top_k": 5 }` and returns only the final `answer`. `POST /v1/query/stream` accepts the same payload and emits newline-delimited JSON `delta`, `done`, or `error` events as the self-hosted model generates the answer. `POST /v1/documents/stream` accepts the same raw document body and headers as `/v1/documents`, then emits NDJSON indexing `progress`, `complete`, or `error` events. A caller must provide `X-API-Key` and matching `X-Tenant-ID` for all routes.

Chat conversations are stored in PostgreSQL and scoped to the authenticated tenant and user. `GET /v1/chats` lists the current user's recent conversations, while `GET /v1/chats/{chat_id}` restores its messages. Pass the returned `chat_id` in subsequent query requests to continue the same conversation.

`DELETE /v1/documents/{document_id}` removes a document's chunks from Qdrant and soft-deletes its PostgreSQL record. It requires the `admin` role. Implement a legal-hold workflow before enabling deletion for regulated records.

`GET /healthz` reports process liveness. `GET /readyz` checks PostgreSQL, Qdrant, MinerU when enabled, and the availability of every configured model ID; it must be used by the deployment platform before routing traffic.

## Chat UI

The API serves a basic same-origin chat UI at `http://127.0.0.1:8080/`. An administrator can upload and index PDF, DOCX, PPTX, XLSX, TXT, PNG, JPEG, and WebP content from the UI, while users can ask questions and see only the final answer. The browser calls only the secured RAG API; it never connects to MinerU, the model server, or Qdrant directly.

The basic UI retains the API key in browser session storage for development convenience. Put the API behind an SSO-enabled gateway and replace this development credential flow with short-lived, HTTP-only session credentials before providing it to end users.

## Production deployment

- The Compose file is intended for a single-node private deployment. It binds only the API to loopback; PostgreSQL and Qdrant have no host-port mappings. Place an authenticated TLS/mTLS gateway in front of the API.
- Replace Compose volumes with encrypted, backed-up storage in your deployment platform. Test restores, not only backups.
- Move schema initialization to reviewed Alembic migrations before multi-replica production rollout. The included startup initialization is safe for the initial schema but is not a migration process.
- Use a secrets manager to inject database credentials and API keys. Rotate credentials and model images on a defined schedule.
- Pin image digests after testing. Versions in Compose are reproducible tags, not immutable digests.

## Development

```bash
uv sync
uv run uvicorn app.main:app --reload
```

Run `uv run pytest` for the local unit tests. The app requires Qdrant, PostgreSQL, MinerU, and an OpenAI-compatible self-hosted model server such as LM Studio for structured ingestion/query operations.

Create the default 500-PDF evaluation corpus with `uv run python -m tools.rag_dataset download`. See the [PDF test dataset guide](docs/test-dataset.md) before downloading or indexing the corpus.
