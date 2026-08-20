# Functional Guide

## Purpose

Secure Document RAG lets authorized users ask questions over private document collections. It is designed for internal healthcare, legal, and financial workflows where document text, embeddings, retrieval, and answer generation must remain within an approved environment.

The service is evidence-first internally: it generates answers only from retrieved document chunks. If it cannot find authorized, relevant material, it declines to answer rather than guessing.

## Roles and access

Every protected request carries a short-lived JWT access token. The token maps one registered person to one organization and an `admin` or `member` role.

| Role | Can ingest | Can query authorized documents | Can delete |
| --- | --- | --- | --- |
| `admin` | Yes | Yes | Yes |
| Other configured role | No | Yes, when document ACL permits | No |

Organization scope comes from the verified JWT and cannot be selected through a request header. A mismatch is rejected before document retrieval.

## Document ingestion

Administrators open `/admin` to upload documents, release bounded compute batches, and manage organization members. The main `/` workspace remains focused on chat and does not embed administrative controls. Members are redirected away from the admin console, and the API independently rejects every unauthorized administrative request.

Platform super administrators have a separate `/super-admin` console. They can see organizations and users across the deployment, suspend access without deleting data, reactivate users or organizations, change organization roles, and revoke user sessions. These actions are audited and protected by final-administrator and self-lockout safeguards.

An administrator uploads a PDF, DOCX, PPTX, XLSX, UTF-8 text file, or supported image through `POST /v1/documents`. The service:

1. Enforces the configured upload size limit.
2. Rejects invalid document names, unsupported formats, empty documents, unsafe parser archives, and documents that create too many chunks.
3. Uses self-hosted MinerU to recover reading order, headings, paragraph text, OCR, formulas, tables, captions, and embedded figures from structured documents.
4. Indexes detailed visual descriptions produced by MinerU directly. Images, charts, diagrams, and forms with missing or weak descriptions are concurrently enriched by a self-hosted vision-language model.
5. Combines text, table content, and visual descriptions, breaks them into overlapping chunks, and creates embeddings through the self-hosted model service.
6. Stores chunks with the document name, tenant collection, and access-control metadata in Qdrant.
7. Registers document metadata and a SHA-256 content fingerprint in PostgreSQL.
8. Records a metadata-only audit event, including extracted table and visual counts. Document content and user questions are not written to the audit table.

Visual search is caption-based: raw image pixels are analyzed transiently by the private vision model, but Qdrant stores only the resulting text description and embedding. This allows normal text questions to retrieve information represented in charts and diagrams without introducing a second incompatible image-vector space.

By default, a document inherits the uploader's roles. An administrator can narrow access using:

- `X-Allowed-Roles: clinician,legal-reviewer`
- `X-Allowed-Users: user-123,user-456`

At least one permitted role or permitted user must match at query time.

### Important current limitation

The service retains extracted chunks in Qdrant and metadata in PostgreSQL, but does **not** retain the original uploaded file. The upstream system must remain the system of record for originals. Before production use, add encrypted private object storage and a re-index workflow if the service must retain original files.

Documents indexed before multimodal support was enabled must be deleted and re-indexed to add their table and visual descriptions. Vision descriptions are model-generated and can omit or misread details; consequential values must be verified against the original document.

## Asking a question

An authorized user sends `POST /v1/query` with a question and optional `top_k` value. When local GPU dispatch is enabled, chat inference is available immediately and does not require an administrator to open a document-processing session. The system embeds the question through the self-hosted model service, retrieves only chunks that match the tenant and document ACL, then asks the self-hosted chat model to answer from that context.

The chat interface uses `POST /v1/query/stream`, so the answer appears incrementally as soon as the model emits text instead of waiting for the full response. Retrieval and authorization still complete before generation begins.

During document ingestion, the interface displays separate upload and indexing percentages. Upload progress measures bytes transferred from the browser. While MinerU parses a document, the API emits periodic extraction progress capped below the next completed stage. Indexing then reports measured progress across chunking, embedding batches, vector storage, and metadata persistence.

### Chat history

Each user's questions and completed assistant answers are saved as a conversation in PostgreSQL. The left sidebar lists recent conversations for the authenticated tenant and user, and selecting one restores its messages. A new-chat control starts a separate conversation. Chat records never cross tenant or user boundaries; production deployments should define retention and deletion schedules that match organizational and regulatory policy.

The response includes only `answer`, a grounded response from the self-hosted model. If there are no permitted results above the configured similarity threshold, the response says it does not have enough information.

## Deleting a document

An administrator can call `DELETE /v1/documents/{document_id}`. This removes the matching chunks from Qdrant and soft-deletes the PostgreSQL metadata record. The action is auditable.

Do not enable this operation for records subject to legal hold, healthcare retention requirements, or regulated retention schedules until a formal records-management workflow is added.

## User-facing behavior and expectations

- Answers may be incomplete if source documents are incomplete, poorly scanned, inaccessible to the caller, or not retrieved.
- Users should review source documents before relying on answers for clinical care, legal advice, trading, lending, compliance, or other high-impact decisions.
- The service is not a substitute for professional review or a compliance certification.
# Free trials

Every newly created organization receives a non-extendable seven-day free trial shared by all its members. During the trial, its administrators can collectively submit at most two PDFs per UTC calendar day. Inviting another member or administrator does not reset the trial or increase the allowance. Non-PDF uploads do not consume this PDF allowance. Members remain query-only, as defined by their organization role. When the trial expires, people can still sign in and manage account access, but querying, new uploads, and starting or releasing compute are blocked. Held documents remain stored. Platform super administrators are exempt from trial restrictions.
