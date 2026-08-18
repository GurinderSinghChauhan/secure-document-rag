# Secure Document RAG

Self-hosted, multi-tenant retrieval-augmented generation (RAG) for sensitive healthcare, legal, and financial documents. Documents, embeddings, vector search, and generation stay inside your controlled network.

## What this starter provides

- A self-hosted OpenAI-compatible model server for embeddings, visual understanding, and answer generation.
- A self-hosted **MinerU** service for layout-aware OCR, reading order, tables, formulas, and figure extraction.
- Self-hosted **Qdrant** for vector storage, with one collection per tenant.
- **PostgreSQL** system of record for document lifecycle and metadata-only audit events.
- FastAPI service with organization accounts, JWT authentication, admin/member roles, document-level ACLs, bounded retrieval context, and readiness probes.
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

Before starting, replace `POSTGRES_PASSWORD`. Development uses console-delivered account links and a development-only JWT signing key. Production startup fails unless secure rotating signing keys, secure cookies, and Resend are configured. Use a secret manager and never commit `.env`.

The first build creates the pinned, pipeline-only `mineru:3.2.1` CUDA image. A one-shot `mineru-models` service downloads only the pipeline weights into the persistent `mineru-models` volume before the private MinerU API starts. Image rebuilds therefore do not duplicate or re-download model weights. MinerU must remain configured with `MINERU_MODEL_SOURCE=local`; do not configure its hosted API for regulated documents. The model initialization follows MinerU's [local-model guidance](https://opendatalab.github.io/MinerU/usage/model_source/).

Multimodal ingestion requires an image-capable model exposed by LM Studio. Set `VISION_MODEL` to an identifier returned by `/v1/models`; readiness verifies the configured embedding, chat, and vision model IDs. The included MinerU service gives its `pipeline` backend access to NVIDIA GPU 0 by default and can be changed with `MINERU_GPU_DEVICE`. On an 8 GB RTX 4060, serialize heavy MinerU work and LM Studio model loading to avoid VRAM exhaustion; use a separate production GPU before switching MinerU to its VLM backend.

For a host without CUDA, layer the CPU override onto the default Compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up --build -d
```

This builds MinerU with CPU-only PyTorch and removes the NVIDIA device reservation. Parsing structured documents will be slower than with a supported GPU.

```bash
ACCESS_TOKEN=$(curl -sS http://127.0.0.1:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"your-long-password"}' | jq -r .access_token)

curl -X POST http://127.0.0.1:8080/v1/documents \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'X-Document-Name: policy.txt' \
  -H 'Content-Type: text/plain' \
  --data-binary @policy.txt

curl -X POST http://127.0.0.1:8080/v1/query \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is the retention period?"}'
```

## Security model

1. **Fail closed:** Production rejects development signing keys, insecure cookies, missing email configuration, and open CORS settings.
2. **Organization boundary:** Each account belongs to one organization, and each organization receives a distinct Qdrant collection.
3. **Document ACL:** Uploads can be restricted to roles and/or explicit users. Retrieval applies those filters before generation.
4. **No sensitive content in logs:** PostgreSQL audit records include only timestamps, actor/organization IDs, actions, and object IDs; queries, passwords, tokens, and chunk text are never logged.
5. **Grounded responses:** The model is told to use only retrieved context. Retrieved sources remain internal and are not returned to the client.
6. **Private network:** PostgreSQL and Qdrant have no host port mappings. The model server remains on the host at `127.0.0.1:1234` and is reached only by the API container. Do not add telemetry, cloud fallback, or third-party observability exporters for regulated workloads without a reviewed data-flow assessment.
7. **Safe lifecycle:** Content is SHA-256 de-duplicated per organization, tracked in PostgreSQL, and can be removed through an admin-only delete endpoint.

## Organization accounts

Open the UI and choose **Create an organization account**. Signup asks for an organization name and generates its internal slug automatically. With the default development configuration, the first account is immediately active and becomes that organization's administrator. Administrators create copyable, 72-hour invitation links for additional `admin` or `member` accounts. Email verification and emailed invitations can be enabled later. Access JWTs last 15 minutes; rotating refresh sessions last 30 days and use HTTP-only cookies.

Password recovery is disabled by default, so the forgot-password endpoint creates no token and sends no email. Set `PASSWORD_RESET_DELIVERY=email` only after configuring a transactional email sender.

Database migrations run automatically before the container starts Uvicorn. For an organization backfilled from existing tenant-scoped data, claim its first administrator interactively:

```bash
docker compose exec api python -m tools.bootstrap_organization_admin <organization-id-or-slug>
```

The command prompts for the password and never accepts it through arguments or environment variables.

## Production hardening

- Terminate TLS at an internal gateway; enforce mTLS between gateway and API where required. Set `ALLOWED_HOSTS` to the gateway's hostname.
- Put volumes on encrypted storage; use KMS-managed keys and rotate JWT signing keys.
- Add OIDC/SSO and MFA before high-risk production use, retaining organization and role claims.
- Send audit events to immutable, access-controlled storage; set retention policies per regulation and legal hold.
- Add antivirus/DLP scanning and malware sandboxing before parsing uploads. Parser rejection is not a substitute for a malware-scanning pipeline.
- Use separate runtime identities, a secrets manager, network policies, backups, restore tests, vulnerability scanning, and model/image pinning.
- Validate retrieval isolation and prompt-injection resistance with adversarial tests before handling production records.

## API

`POST /v1/documents` saves `text/plain`, PDF, DOCX, PPTX, XLSX, PNG, JPEG, or WebP request bodies as durable `held_for_compute` jobs. It never starts GPU capacity. An authenticated administrator must explicitly enable dispatch, open a bounded compute session, and release selected jobs. MinerU and model inference run only after that release.

Indexing is idempotent per tenant and file content. Releasing a repeat upload rebuilds vectors under the existing document ID and updates its metadata and ACLs.

- `X-Document-Name` (required)
- `X-Allowed-Roles`: comma-separated role list
- `X-Allowed-Users`: comma-separated user IDs

`POST /v1/query` and `/v1/query/stream` refuse inference when no compute session is open; queries never wake a GPU. `POST /v1/documents/stream` emits a completion event after the durable held job is created. Admin endpoints under `/v1/admin/compute-sessions` open, release, drain, cancel, and report bounded sessions. `GET /v1/admin/ingestion-jobs?state=held_for_compute` lists selectable work.

Chat conversations are stored in PostgreSQL and scoped to the authenticated tenant and user. `GET /v1/chats` lists the current user's recent conversations, while `GET /v1/chats/{chat_id}` restores its messages. Pass the returned `chat_id` in subsequent query requests to continue the same conversation.

`DELETE /v1/documents/{document_id}` removes a document's chunks from Qdrant and soft-deletes its PostgreSQL record. It requires the `admin` role. Implement a legal-hold workflow before enabling deletion for regulated records.

`GET /healthz` reports process liveness. `GET /readyz` checks only control-plane PostgreSQL and Qdrant and reports compute as enabled-idle or disabled. It deliberately does not poll MinerU, model servers, or a GPU provider.

## Cost-controlled GPU processing

`GPU_DISPATCH_ENABLED=false` is the default. Provider configuration and dispatch activation are separate. `COMPUTE_PROVIDER=local_docker` runs released jobs serially through the local stack. The optional Runpod adapter implements submit, status, and cancellation for an existing serverless endpoint, but this repository never provisions an endpoint or configures a minimum worker count. Hosted artifact exchange remains fail-closed until configured; no paid provider was contacted while implementing or testing this support.

Every session requires `max_jobs` and `max_gpu_minutes`, plus an optional `max_estimated_cost_usd`. The dispatcher stops at its bounds, returns retryable failures to held state, and closes the session when released work drains. The initial profile targets a quantized Qwen3-VL-4B on a 16 GB NVIDIA pool, with a configurable 24 GB fallback for out-of-memory retries.

## Chat UI

The API serves a basic same-origin chat UI at `http://127.0.0.1:8080/`. An administrator can upload and index PDF, DOCX, PPTX, XLSX, TXT, PNG, JPEG, and WebP content from the UI, while users can ask questions and see only the final answer. The browser calls only the secured RAG API; it never connects to MinerU, the model server, or Qdrant directly.

The UI keeps the short-lived access JWT only in memory and restores sessions through a rotating, HTTP-only refresh cookie. Registration creates an organization and its first administrator; additional accounts join by invitation.

## Production deployment

- The Compose file is intended for a single-node private deployment. It binds only the API to loopback; PostgreSQL and Qdrant have no host-port mappings. Place an authenticated TLS/mTLS gateway in front of the API.
- Replace Compose volumes with encrypted, backed-up storage in your deployment platform. Test restores, not only backups.
- Move schema initialization to reviewed Alembic migrations before multi-replica production rollout. The included startup initialization is safe for the initial schema but is not a migration process.
- Use a secrets manager to inject database, JWT-signing, and email credentials. Rotate credentials and model images on a defined schedule.
- Pin image digests after testing. Versions in Compose are reproducible tags, not immutable digests.

## Development

```bash
uv sync
uv run uvicorn app.main:app --reload
```

Run `uv run pytest` for the local unit tests. The app requires Qdrant, PostgreSQL, MinerU, and an OpenAI-compatible self-hosted model server such as LM Studio for structured ingestion/query operations.

Create the default 500-PDF evaluation corpus with `uv run python -m tools.rag_dataset download`. See the [PDF test dataset guide](docs/test-dataset.md) before downloading or indexing the corpus.
