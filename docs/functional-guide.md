# Functional Guide

## Purpose

Secure Document RAG lets authorized users ask questions over private document collections. It is designed for internal healthcare, legal, and financial workflows where document text, embeddings, retrieval, and answer generation must remain within an approved environment.

The service is evidence-first: it returns the answer together with the document chunks used to create it. If it cannot find authorized, relevant material, it declines to answer rather than guessing.

## Roles and access

Every request carries an API key and tenant ID. The configured key maps to one tenant, user, and role set.

| Role | Can ingest | Can query authorized documents | Can delete |
| --- | --- | --- | --- |
| `admin` | Yes | Yes | Yes |
| Other configured role | No | Yes, when document ACL permits | No |

The tenant in `X-Tenant-ID` must match the tenant bound to the API key. A mismatch is rejected before document retrieval.

## Document ingestion

An administrator uploads a PDF, DOCX, or UTF-8 text file through `POST /v1/documents`. The service:

1. Enforces the configured upload size limit.
2. Rejects invalid document names, unsupported formats, encrypted PDFs, empty documents, and documents that create too many chunks.
3. Extracts text, breaks it into overlapping chunks, and creates embeddings through the self-hosted Ollama service.
4. Stores chunks with the document name, tenant collection, and access-control metadata in Qdrant.
5. Registers document metadata and a SHA-256 content fingerprint in PostgreSQL.
6. Records a metadata-only audit event. Document content and user questions are not written to the audit table.

By default, a document inherits the uploader's roles. An administrator can narrow access using:

- `X-Allowed-Roles: clinician,legal-reviewer`
- `X-Allowed-Users: user-123,user-456`

At least one permitted role or permitted user must match at query time.

### Important current limitation

The service retains extracted chunks in Qdrant and metadata in PostgreSQL, but does **not** retain the original uploaded file. The upstream system must remain the system of record for originals. Before production use, add encrypted private object storage and a re-index workflow if the service must retain original files.

## Asking a question

An authorized user sends `POST /v1/query` with a question and optional `top_k` value. The system embeds the question through the self-hosted model service, retrieves only chunks that match the tenant and document ACL, then asks the self-hosted chat model to answer from that context.

The response includes:

- `answer`: grounded response from the self-hosted model.
- `citations`: document ID, document name, chunk index, and similarity score for the context used.

If there are no permitted results above the configured similarity threshold, the response says it does not have enough information and returns no citations.

## Deleting a document

An administrator can call `DELETE /v1/documents/{document_id}`. This removes the matching chunks from Qdrant and soft-deletes the PostgreSQL metadata record. The action is auditable.

Do not enable this operation for records subject to legal hold, healthcare retention requirements, or regulated retention schedules until a formal records-management workflow is added.

## User-facing behavior and expectations

- Answers may be incomplete if source documents are incomplete, poorly scanned, inaccessible to the caller, or not retrieved.
- Citations show supporting chunks, not a legal, medical, or financial determination.
- Users should review source documents before relying on answers for clinical care, legal advice, trading, lending, compliance, or other high-impact decisions.
- The service is not a substitute for professional review or a compliance certification.
