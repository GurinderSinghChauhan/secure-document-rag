# Technical Guide

## Architecture

```text
Client -> TLS / mTLS gateway -> FastAPI API -> Self-hosted OpenAI-compatible model server (embeddings + chat)
                                      |       -> Qdrant (chunk vectors + ACL payload)
                                      `------> PostgreSQL (document metadata + audit events)
```

All services are intended to run in a private network. Docker Compose publishes only the API port to `127.0.0.1`; place a hardened internal gateway in front of it for TLS, mTLS, SSO, rate limits, and request logging policy.

## Components

| Component | Responsibility | Persistent data |
| --- | --- | --- |
| FastAPI | Authentication, authorization, parsing, orchestration, lifecycle API | None |
| Model server | Self-hosted OpenAI-compatible embedding and chat inference | Model weights |
| Qdrant | Cosine similarity search over text chunks and ACL payload filters | Vectors, chunk text, citations metadata |
| PostgreSQL | Document registry, SHA-256 deduplication, soft-delete state, audit events | Metadata only |

## Data flow

### Ingestion

1. The API authenticates the API key and verifies its tenant claim against `X-Tenant-ID`.
2. Only callers with the `admin` role may ingest.
3. The request body is streamed into a bounded in-memory buffer, with both declared and actual upload-size checks.
4. The parser supports plain text, PDF, and DOCX. Encrypted PDFs are rejected.
5. `chunk_text` normalizes whitespace and creates 1,200-character chunks with a 200-character overlap.
6. The model server creates dense embeddings using `EMBEDDING_MODEL`.
7. Qdrant stores each vector with `document_id`, `document_name`, `chunk_index`, `text`, `allowed_roles`, and `allowed_users`.
8. PostgreSQL records the document metadata and SHA-256 content hash. A duplicate active hash within the same tenant is rejected.

### Retrieval

1. The model server embeds the question.
2. Qdrant searches the requesting tenant's collection using cosine similarity.
3. Qdrant applies an ACL filter: the user must match an allowed user or at least one allowed role.
4. Results below `MIN_RETRIEVAL_SCORE` are excluded.
5. The API includes only as many chunks as fit within `MAX_CONTEXT_CHARACTERS`.
6. The chat prompt instructs the model server to answer only from supplied context and disregard instructions found in documents.
7. The API returns the answer and citations; the query text is never added to the audit record.

## API contract

All protected endpoints require:

```http
X-API-Key: <secret>
X-Tenant-ID: <tenant-id>
```

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/healthz` | None | Process liveness only |
| `GET` | `/readyz` | None | Dependency readiness for PostgreSQL, Qdrant, and Ollama |
| `POST` | `/v1/documents` | Admin | Ingest a document body |
| `POST` | `/v1/query` | Authorized user | Retrieve and generate a cited answer |
| `DELETE` | `/v1/documents/{document_id}` | Admin | Remove vectors and soft-delete metadata |

## Configuration

| Variable | Description |
| --- | --- |
| `TENANT_API_KEYS_JSON` | JSON map from API key to `tenant_id`, `user_id`, and `roles`; keys must be at least 32 characters |
| `DATABASE_URL` | SQLAlchemy async PostgreSQL connection URL |
| `QDRANT_URL` | Private Qdrant endpoint |
| `MODEL_SERVER_URL` | OpenAI-compatible endpoint for the self-hosted model server |
| `EMBEDDING_MODEL` / `CHAT_MODEL` | Embedding and chat model IDs exposed by the self-hosted model server |
| `MAX_UPLOAD_BYTES` | Hard upload-byte limit |
| `MAX_DOCUMENT_CHUNKS` | Upper limit on chunks created from one upload |
| `MAX_CONTEXT_CHARACTERS` | Upper limit on context supplied to the chat model |
| `MIN_RETRIEVAL_SCORE` | Minimum Qdrant similarity score used for answer context |
| `ALLOWED_HOSTS` | Comma-separated hostnames accepted by the API |

## Operations

- Use `GET /healthz` for liveness and `GET /readyz` for traffic readiness.
- Keep Qdrant and PostgreSQL off public networks. Keep the model server bound to `127.0.0.1` and do not expose its port externally.
- Use encrypted storage and tested restore procedures for Qdrant and PostgreSQL volumes.
- Inject configuration via a secrets manager; never retain production API keys in `.env` or source control.
- Use migrations for all future schema changes. The current `create_all` startup initialization is an initial-schema convenience, not a production migration strategy.
- Pin and scan container image digests after model and integration testing.

## Production gaps to close

The current service establishes a secure application baseline. Before handling regulated production data, add:

1. OIDC/SAML identity integration and attribute-based authorization instead of static API-key configuration.
2. Encrypted private object storage for original files, versioning, and re-indexing.
3. Malware/DLP scanning, OCR for scanned PDFs, and an asynchronous ingestion queue.
4. Alembic migrations, database backup/restore exercises, and an immutable external audit sink.
5. Hybrid lexical + vector retrieval, reranking, evaluation datasets, and tenant-isolation / prompt-injection test suites.
6. Legal-hold and retention-policy enforcement before enabling deletion for regulated records.
