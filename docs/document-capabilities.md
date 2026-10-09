# Document capabilities and deployment boundaries

Source synchronization remains deferred. Folder uploads are manual; no watchers,
cloud subscriptions or background synchronization have been added.

## Verified page counts

Run `uv run alembic upgrade head` before deploying this change. New PDF uploads
are counted on the server from their page tree, including blank pages. Invalid,
empty and encrypted PDFs are rejected before being queued. The verified count is
stored on the ingestion job and on the successfully indexed document, returned
by their existing APIs, and shown in the queue and document library.

Historical records and non-PDF formats have a null count, not zero. Reflowable
Word/text documents require an agreed rendering process before page billing can
be accurate. Counts are pricing inputs, not an invoice or usage ledger. Do not
sum ingestion jobs for billing: retries and metadata extraction can reference
the same source. A billing policy still needs to define whether charges apply
per unique source, per successful indexing run, or per billing period.

## Conversation memory

Both query endpoints include recent user and assistant messages from the same
user-owned chat. The default window is 12 messages and at most 8,000 characters;
whole messages outside the window remain in saved history but are not sent to
the model. Configure `CHAT_MEMORY_MESSAGES` and `CHAT_MEMORY_CHARACTERS` to
adjust the window; setting either to zero disables memory. No database migration
is needed for conversation memory.

Follow-up questions such as "explain point two" are rewritten into standalone
search questions using that window. If rewriting fails, search uses the original
question. This adds one model call for chats with usable prior messages.
Answers receive the original question and recent conversation, but previous
answers are not document evidence. Retrieval still applies current tenant and
document ACL restrictions. With no retrieved sources, the app declines to answer
even if an old answer exists. Reopening a chat restores its recent memory;
starting a new chat does not inherit another chat's messages.

To check manually, ask a document question that produces numbered points, then
ask "Explain point two" in that same chat. Verify the answer addresses the
correct point and is grounded in accessible documents. Reopen the chat and try
another follow-up. Start a new chat and verify the earlier points are not known.

## Languages and financial reports

Answers are instructed to use the question's language, unless another language
is requested, even when the source language differs. Numeric values and names
must remain faithful to sources. Cross-language retrieval additionally requires
a multilingual embedding model hosted at the configured model endpoint; the
default embedding model is not a promise of cross-language retrieval quality.
Use the same model for ingestion and questions. Changing embedding models
requires rebuilding the vector collection and reindexing documents, even if
the dimensions match. Validate representative customer language pairs before
enabling this capability in production.

Existing table transcription and chart-description paths now explicitly preserve
financial units, periods, signs and percentages. Answer instructions separate
reported values from calculations, prohibit replacing missing cells with zero,
and require chart estimates to be labeled. These safeguards are model
instructions, not audited financial calculations or guaranteed OCR accuracy.
Verify material financial decisions against the cited original report.

## Customer-owned infrastructure

The local deployment path uses the customer's API, database, vector store,
document parser and configured model endpoint. Keep `COMPUTE_PROVIDER=local_docker`
and point model endpoints at customer-controlled services. The optional RunPod
provider is an external service and must not be enabled for a strictly
customer-owned deployment. Configure authentication, TLS, network restrictions,
backups and outbound firewall rules before production use. Actual air-gapped
operation requires preloading container images and model artifacts; it has not
been validated by these code changes.
