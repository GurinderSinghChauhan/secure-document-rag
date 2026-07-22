# Secure Document RAG

Self-hosted, multi-tenant retrieval-augmented generation (RAG) for sensitive healthcare, legal, and financial documents. Documents, embeddings, vector search, and generation stay inside your controlled network.

## What this starter provides

- A self-hosted OpenAI-compatible model server for embeddings and answer generation.
- Self-hosted **Qdrant** for vector storage, with one collection per tenant.
- **PostgreSQL** system of record for document lifecycle and metadata-only audit events.
- FastAPI service with API-key authentication, tenant enforcement, document-level ACLs, bounded retrieval context, source citations, and readiness probes.
- Docker deployment that exposes the application only on `127.0.0.1` by default; Qdrant and Ollama are private to the Docker network.

This is an application foundation, not a compliance certification. HIPAA, GLBA, PCI DSS, SEC, GDPR, and legal-hold obligations require organization-specific controls, policies, reviews, and evidence.

## Documentation

- [Functional guide](docs/functional-guide.md): user roles, document lifecycle, expected behavior, and operational limitations.
- [Technical guide](docs/technical-guide.md): architecture, data flow, API contract, configuration, operations, and production gaps.

## Quick start

```bash
cp .env.example .env
docker compose up --build -d
```

Before starting, replace the example `TENANT_API_KEYS_JSON` and `POSTGRES_PASSWORD` values in `.env`. The service refuses to start with an example API key. Use secrets supplied by your secret manager in real deployments; do not commit `.env`.

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
5. **Grounded responses:** The model is told to use only retrieved context and returns citations for every answer.
6. **Private network:** PostgreSQL and Qdrant have no host port mappings. The model server remains on the host at `127.0.0.1:1234` and is reached only by the API container. Do not add telemetry, cloud fallback, or third-party observability exporters for regulated workloads without a reviewed data-flow assessment.
7. **Safe lifecycle:** Content is SHA-256 de-duplicated per tenant, tracked in PostgreSQL, and can be removed through an admin-only delete endpoint.

## Production hardening

- Terminate TLS at an internal gateway; enforce mTLS between gateway and API where required. Set `ALLOWED_HOSTS` to the gateway's hostname.
- Put volumes on encrypted storage; use KMS-managed keys and rotate API keys.
- Replace the environment key map with OIDC/JWT verification or your identity provider, retaining the tenant and role claims.
- Send audit events to immutable, access-controlled storage; set retention policies per regulation and legal hold.
- Add antivirus/DLP scanning and malware sandboxing before parsing uploads. The current parser rejects encrypted PDFs but does not replace a malware-scanning pipeline.
- Use separate runtime identities, a secrets manager, network policies, backups, restore tests, vulnerability scanning, and model/image pinning.
- Validate retrieval isolation and prompt-injection resistance with adversarial tests before handling production records.

## API

`POST /v1/documents` ingests `text/plain`, PDF, or DOCX request bodies. Optional headers:

- `X-Document-Name` (required)
- `X-Allowed-Roles`: comma-separated role list
- `X-Allowed-Users`: comma-separated user IDs

`POST /v1/query` accepts `{ "question": "...", "top_k": 5 }` and returns `answer` plus source citations. A caller must provide `X-API-Key` and matching `X-Tenant-ID` for both routes.

`DELETE /v1/documents/{document_id}` removes a document's chunks from Qdrant and soft-deletes its PostgreSQL record. It requires the `admin` role. Implement a legal-hold workflow before enabling deletion for regulated records.

`GET /healthz` reports process liveness. `GET /readyz` checks PostgreSQL, Qdrant, and the model server readiness; it must be used by the deployment platform before routing traffic.

## Chat UI

The API serves a basic same-origin chat UI at `http://127.0.0.1:8080/`. It calls only `POST /v1/query` and renders the returned citations; it never connects to Ollama or Qdrant from the browser.

The basic UI retains the API key in browser session storage for development convenience. Put the API behind an SSO-enabled gateway and replace this development credential flow with short-lived, HTTP-only session credentials before providing it to end users.

## Production deployment

- The Compose file is intended for a single-node private deployment. It binds only the API to loopback; place an authenticated TLS/mTLS gateway in front of it.
- Replace Compose volumes with encrypted, backed-up storage in your deployment platform. Test restores, not only backups.
- Move schema initialization to reviewed Alembic migrations before multi-replica production rollout. The included startup initialization is safe for the initial schema but is not a migration process.
- Use a secrets manager to inject database credentials and API keys. Rotate credentials and model images on a defined schedule.
- Pin image digests after testing. Versions in Compose are reproducible tags, not immutable digests.

## Development

```bash
uv sync
uv run uvicorn app.main:app --reload
```

Run `uv run pytest` for the local unit tests. The app requires Qdrant and Ollama for ingestion/query operations.
