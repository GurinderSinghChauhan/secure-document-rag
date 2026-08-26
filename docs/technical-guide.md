# Technical Guide

## Architecture

```text
Client -> TLS / mTLS gateway -> FastAPI API -> MinerU (layout, OCR, tables, figures)
                                      |       -> Self-hosted model server (vision + embeddings + chat)
                                      |       -> Qdrant (chunk vectors + ACL payload)
                                      `------> PostgreSQL (document metadata + audit events)
```

All services are intended to run in a private network. Docker Compose publishes only the API port to `127.0.0.1`; place a hardened internal gateway in front of it for TLS, mTLS, SSO, rate limits, and request logging policy.

## Components

| Component | Responsibility | Persistent data |
| --- | --- | --- |
| FastAPI | Authentication, authorization, parsing, orchestration, lifecycle API | None |
| MinerU | Layout-aware parsing, reading order, OCR, formulas, tables, and figure extraction | Local model weights and transient task output |
| Model server | Self-hosted OpenAI-compatible vision, embedding, and chat inference | Model weights |
| Qdrant | Cosine similarity search over text chunks and ACL payload filters | Vectors, chunk text, and source metadata |
| PostgreSQL | Document registry, SHA-256 deduplication, soft-delete state, audit events | Metadata only |

## Data flow

### Ingestion

1. The API verifies the access JWT signature, issuer, audience, expiration, user token version, organization membership, and role.
2. Only callers with the `admin` role may ingest.
3. The request body is streamed into a bounded in-memory buffer, with both declared and actual upload-size checks.
4. PDF, DOCX, PPTX, and XLSX bodies are sent over the private network to MinerU's `/file_parse` endpoint. The API requests an in-memory ZIP containing Markdown, legacy content-list JSON, and extracted images; it rejects unsafe paths and archives exceeding `MINERU_MAX_OUTPUT_BYTES`.
5. MinerU preserves reading order and emits OCR text, HTML tables, formulas, captions, chart content, and figure paths. Detailed visual descriptions are indexed directly, avoiding a redundant model call. Only descriptions shorter than `MINERU_VISUAL_ENRICHMENT_MIN_CHARACTERS` are normalized by Pillow and sent to `VISION_MODEL`.
6. Remaining visual requests run with bounded `VISUAL_ANALYSIS_CONCURRENCY`. The vision prompt asks for searchable chart values, diagram relationships, labels, OCR text, and visible objects while treating image text as untrusted data. Raw visual bytes are released after ingestion and are not stored in Qdrant or PostgreSQL.
7. Without `X-Document-Type`, the chat model must select exactly one registered schema key and a bounded confidence score while treating source text as untrusted. Results at or above `CLASSIFICATION_AUTO_ACCEPT_THRESHOLD` are confirmed; results at or above `CLASSIFICATION_REVIEW_THRESHOLD` are retained and flagged for review; lower or invalid results remain unclassified. A valid header bypasses detection as a manual override.
8. For classified documents, the model server extracts only the selected schema's configured fields. PostgreSQL records classification source/status/confidence, schema version, extraction status, and the filtered JSON result; classification or extraction failure does not prevent indexing.
9. `chunk_text` combines extracted text, table content, and visual descriptions into 1,200-character chunks with a 200-character overlap.
10. The model server creates dense text embeddings using `EMBEDDING_MODEL` in batches of `EMBEDDING_BATCH_SIZE`. This implementation uses caption-based visual retrieval rather than a separate image embedding space.
11. Qdrant stores each vector with `document_id`, `document_name`, `chunk_index`, `text`, `allowed_roles`, and `allowed_users`.
12. PostgreSQL records the document metadata and SHA-256 content hash. A duplicate active hash within the same tenant is rejected.

### Retrieval

1. The model server embeds the question.
2. Qdrant searches the requesting tenant's collection using cosine similarity.
3. Qdrant applies an ACL filter: the user must match an allowed user or at least one allowed role.
4. Results below `MIN_RETRIEVAL_SCORE` are excluded.
5. The API includes only as many chunks as fit within `MAX_CONTEXT_CHARACTERS`.
6. The chat prompt instructs the model server to answer only from supplied context and disregard instructions found in documents.
7. The API returns only the answer; retrieved source metadata and the query text are not added to the audit record or response.

## API contract

All protected endpoints require:

```http
Authorization: Bearer <short-lived-access-jwt>
```

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/healthz` | None | Process liveness only |
| `GET` | `/readyz` | None | Control-plane readiness for PostgreSQL and Qdrant; never wakes or polls GPU compute |
| `POST` | `/v1/auth/register` | None | Create an organization and pending first administrator |
| `POST` | `/v1/auth/login` | None | Authenticate and issue an access JWT plus refresh cookie |
| `POST` | `/v1/auth/refresh` | Refresh cookie | Rotate the refresh session and issue a new access JWT |
| `POST` | `/v1/auth/logout` | Refresh cookie | Revoke the current refresh session |
| `GET` | `/v1/auth/me` | Authorized user | Return the current account, role, and organization |
| `GET/PATCH/POST/PUT` | `/v1/super-admin/*` | Platform super admin | Inspect organizations/users, control access, and list or evaluate chat responses |
| `GET` | `/v1/admin/documents` | Organization admin | List active indexed documents for the authenticated organization |
| `GET` | `/v1/document-schemas` | Authorized user | List versioned industry and document-type extraction schemas |
| `GET` | `/v1/dashboard` | Authorized user | Return ACL-filtered document-intelligence summaries and recent documents |
| `DELETE` | `/v1/documents/{document_id}` | Organization admin | Remove document vectors and soft-delete organization-scoped metadata |
| `GET` | `/version` | Public | Report semantic application version and source commit |

Chat evaluations are stored separately in `chat_response_evaluations`, with one mutable evaluation per assistant message. The database constrains each rubric dimension (correctness, relevance, and clarity) to 1–5. The API computes the displayed overall score as the arithmetic mean, attributes updates to the current super administrator, and writes only response IDs and numeric scores—not question, answer, or reviewer-note content—to the audit event.

Held-job responses include file type, byte size, and a conservative GPU-minute ceiling hint. Plain text uses the lightest baseline, images use a moderate baseline, and PDF/Office formats use the parsing-heavy baseline, with a size-based increment. The browser sums those hints and counts the jobs whenever the selection changes, exposing both as read-only controls. This is a guardrail estimate rather than a throughput promise: actual GPU seconds remain measured by the dispatcher, and the session closes when its selected work drains.

### Build identity and automation

`VERSION` is loaded by `app/version.py` and exposed by FastAPI and `GET /version`. `tools/version.py` updates `VERSION` and `pyproject.toml`, refreshes `uv.lock`, and rejects anything except a stable `X.Y.Z` semantic version. It can also calculate an increment from Conventional Commit intent: breaking changes select major, `feat:` selects minor, and other changes select patch. CI checks that all three declarations agree. Docker releases receive `APP_COMMIT` as a build argument and OCI source, revision, and version labels.

GitHub Actions uses one workflow with dependent jobs. The validation job has read-only access. After it succeeds on `main`, the release job alone receives `contents: write` and `packages: write`. It retains an explicitly prepared unreleased version or calculates the next version, commits synchronized metadata with `[skip ci]`, tags that exact commit, publishes the API image to GHCR, and generates a GitHub release. Pull requests never run the release job, and the workflow does not build or publish the hardware-specific MinerU image.
| `GET/POST/PATCH` | `/v1/admin/organization/*` | Organization admin | Manage invitations, members, roles, and sessions |
| `POST` | `/v1/documents` | Admin | Ingest a document body |
| `POST` | `/v1/query` | Authorized user | Retrieve and generate a cited answer |
| `POST` | `/v1/query/stream` | Authorized user | Retrieve and stream an NDJSON answer |
| `POST` | `/v1/documents/stream` | Tenant admin | Save a document as a durable `held_for_compute` job |
| `GET` | `/v1/admin/ingestion-jobs` | Tenant admin | List held and historical ingestion jobs |
| `POST` | `/v1/admin/compute-sessions` | Tenant admin | Open a manually bounded compute session |
| `POST` | `/v1/admin/compute-sessions/{id}/release` | Tenant admin | Release selected held jobs within explicit limits |
| `POST` | `/v1/admin/compute-sessions/{id}/drain` | Tenant admin | Stop accepting more work into a session |
| `POST` | `/v1/admin/compute-sessions/{id}/cancel` | Tenant admin | Cancel local work and return unfinished jobs to held state |
| `GET` | `/v1/admin/compute-sessions/{id}` | Tenant admin | Report stages, GPU seconds, estimated cost, and limits |
| `GET` | `/v1/chats` | Authorized user | List the user's recent tenant-scoped chats |
| `GET` | `/v1/chats/{chat_id}` | Authorized user | Restore one owned conversation and its messages |
| `DELETE` | `/v1/documents/{document_id}` | Admin | Remove vectors and soft-delete metadata |

## Configuration

| Variable | Description |
| --- | --- |
| `JWT_SIGNING_KEYS_JSON` | Key-ID to signing-secret map; every key must contain at least 48 characters |
| `JWT_ACTIVE_KEY_ID` | Key ID used to sign new access tokens while old keys remain valid for rotation |
| `PUBLIC_APP_URL` | Canonical origin used for account links and cookie-origin validation |
| `EMAIL_VERIFICATION_REQUIRED` | Require new accounts to follow an emailed verification link; defaults to `false` |
| `INVITATION_DELIVERY` | `manual` returns a copyable admin-only link; `email` sends it through the configured sender |
| `PASSWORD_RESET_DELIVERY` | `disabled` creates no reset token or email; `email` enables the email reset flow |
| `EMAIL_SENDER` | `console` for development or `resend` for production |
| `RESEND_API_KEY` | Required with secure cookies and non-development signing keys in production |
| `DATABASE_URL` | SQLAlchemy async PostgreSQL connection URL |
| `QDRANT_URL` | Private Qdrant endpoint |
| `MODEL_SERVER_URL` | OpenAI-compatible endpoint for the self-hosted model server |
| `EMBEDDING_MODEL` / `CHAT_MODEL` | Embedding and chat model IDs exposed by the self-hosted model server |
| `VISION_MODEL` | Image-capable model ID used to describe charts, diagrams, embedded images, forms, and scanned pages |
| `MINERU_ENABLED` | Require MinerU for supported structured document formats and readiness checks |
| `MINERU_URL` | Private base URL for the self-hosted MinerU API |
| `MINERU_BACKEND` | MinerU parser backend; `pipeline` supports GPU acceleration with lower VRAM pressure than the VLM backend |
| `MINERU_IMAGE` / `MINERU_GPU_DEVICE` | Pinned local image tag and NVIDIA GPU device assigned to MinerU |
| `MINERU_TIMEOUT_SECONDS` | End-to-end parsing timeout for one MinerU request |
| `MINERU_MAX_OUTPUT_BYTES` | Maximum compressed response and declared uncompressed archive size accepted from MinerU |
| `MINERU_VISUAL_ENRICHMENT_MIN_CHARACTERS` | Minimum MinerU visual-description length that bypasses secondary Qwen enrichment |
| `MAX_UPLOAD_BYTES` | Hard upload-byte limit |
| `MAX_DOCUMENT_CHUNKS` | Upper limit on chunks created from one upload |
| `MAX_VISUALS_PER_DOCUMENT` | Maximum visual assets or rendered pages analyzed from one document |
| `VISUAL_ANALYSIS_CONCURRENCY` | Maximum simultaneous fallback visual-description requests |
| `VISION_MAX_TOKENS` | Maximum caption tokens generated for each visual asset |
| `EMBEDDING_BATCH_SIZE` | Number of text chunks submitted per embedding request |
| `MAX_CONTEXT_CHARACTERS` | Upper limit on context supplied to the chat model |
| `MIN_RETRIEVAL_SCORE` | Minimum Qdrant similarity score used for answer context |
| `CLASSIFICATION_AUTO_ACCEPT_THRESHOLD` | Minimum automatic classification confidence accepted without review; defaults to `0.85` |
| `CLASSIFICATION_REVIEW_THRESHOLD` | Minimum confidence retained as a provisional type requiring review; defaults to `0.60` and must be lower than the auto-accept threshold |
| `ALLOWED_HOSTS` | Comma-separated hostnames accepted by the API |

## Operations

- Use `GET /healthz` for liveness and `GET /readyz` for control-plane traffic readiness. Neither endpoint contacts a compute provider.
- The default Compose stack builds a pipeline-only PyTorch/CUDA MinerU image, keeps its API private, and assigns NVIDIA GPU 0 with host IPC and the official memory/stack ulimits. A one-shot initializer stores only pipeline model weights in the persistent `mineru-models` volume, separate from the image. On an 8 GB card, serialize heavy MinerU work and LM Studio model loading to avoid out-of-memory failures. Use a separate GPU worker before switching MinerU to its VLM backend.
- Keep MinerU, Qdrant, and PostgreSQL off public networks. Keep the model server bound to `127.0.0.1` and do not expose its port externally. Remote MinerU or model URLs would transmit document content and must not be used without an approved data-flow review.
- Use encrypted storage and tested restore procedures for Qdrant and PostgreSQL volumes.
- Inject signing and email credentials via a secrets manager; never retain production secrets in `.env` or source control.
- Use migrations for all future schema changes. The current `create_all` startup initialization is an initial-schema convenience, not a production migration strategy.
- Pin and scan container image digests after model and integration testing.
- Review third-party licenses as part of release governance. MinerU uses an Apache-2.0-based custom license with online-service attribution and commercial thresholds; retain the required notice and obtain legal approval before release.
- Platform super-admin authority is stored separately from organization membership and included in signed access-token claims. Use `python -m tools.bootstrap_super_admin` interactively inside the API container to promote an existing verified account. Never expose platform promotion through public registration or environment configuration.

## Production gaps to close

The current service establishes a secure application baseline. Before handling regulated production data, add:

1. OIDC/SAML identity integration and attribute-based authorization instead of static API-key configuration.
2. Encrypted private object storage for original files, versioning, and re-indexing.
3. Malware/DLP scanning, a deterministic OCR fallback for difficult scans, and an asynchronous ingestion queue for large multimodal batches.
4. Alembic migrations, database backup/restore exercises, and an immutable external audit sink.
5. Hybrid lexical + vector retrieval, reranking, evaluation datasets, and tenant-isolation / prompt-injection test suites.
6. Legal-hold and retention-policy enforcement before enabling deletion for regulated records.
# Trial enforcement

Trial dates are stored in `organizations.trial_started_at` and `organizations.trial_ends_at`; migration `20260819_03` backfills existing organizations from their original creation time. Enforcement is server-side. Questions are counted from durable user-role chat messages joined to their tenant- and user-scoped chat sessions for the current UTC day. A row lock on the user serializes concurrent submissions, and the accepted question is committed before releasing that lock, so parallel requests cannot exceed the five-question allowance. PDF submissions are counted from durable ingestion jobs by organization and UTC day, with a row lock on the organization to serialize concurrent submissions. Expiry checks protect query, upload, compute-session creation, and job release. Super administrators bypass these checks. There is intentionally no renewal or paid-entitlement API yet.
