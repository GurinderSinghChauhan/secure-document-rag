# Product readiness

Arcline has a strong technical product foundation, but a successful build is not the same as authorization to process customer or regulated data. This document separates controls that are implemented from business and operational gates that must be completed before a customer launch.

## Implemented baseline

- Organization-scoped authentication, role checks, document ACL filters, rotating refresh sessions, shared PostgreSQL-backed authentication rate limits, and metadata-only audit events.
- Fail-closed production configuration for signing keys, secure cookies, HTTPS, verified email, invitation delivery, password recovery, and allowed hosts.
- Bounded uploads, parser limits, compute time and cost limits, explicit compute release, soft deletion, and service readiness probes.
- Defensive browser headers, immutable hashed asset caching, non-root read-only API containers, dropped Linux capabilities, and private Docker networking.
- Locked Python and npm dependencies, automated dependency and container vulnerability checks, weekly dependency update proposals, unit tests, browser navigation tests, automated WCAG checks, migration checks, and image builds in CI.
- Customer-visible application version and release images labelled with their source revision.
- Browser speech recognition is disabled by default because vendors may process audio outside the self-hosted boundary; enable it only after a deployment-specific data-flow review.

## Launch-blocking decisions

These items require product, legal, infrastructure, or customer decisions and cannot be completed safely with code defaults:

1. **Identity:** implement customer-approved SSO and phishing-resistant MFA. Local passwords are suitable for controlled evaluation, not an enterprise identity strategy.
2. **Backups:** define encrypted PostgreSQL, Qdrant, and source-document backups; document restore steps; and pass a timed restore exercise.
3. **Observability:** select a privacy-reviewed metrics, structured logging, alerting, and error-reporting stack. Define on-call ownership and remove sensitive payloads from telemetry.
4. **Security assurance:** complete threat modelling, independent penetration testing, key-rotation rehearsal, and incident-response exercises.
5. **Data governance:** approve retention, deletion, legal hold, data residency, subprocessors, model licensing, acceptable-use, and data-processing terms for every target market.
6. **Reliability:** publish service-level objectives, capacity limits, recovery objectives, maintenance windows, and a tested rollback procedure.
7. **Customer operations:** establish support channels, escalation ownership, status communication, onboarding, offboarding, export, and account-recovery procedures.
8. **Accessibility:** perform keyboard, zoom, contrast, and assistive-technology testing with representative users in addition to automated WCAG checks.
9. **AI assurance:** define evaluation datasets, quality thresholds, model-change approval, hallucination monitoring, and human-verification requirements for consequential decisions.
10. **Commercial terms:** choose and document the software license, warranty position, pricing, service terms, privacy notice, and customer contract. The repository does not currently declare a license.

## Release evidence required

Every customer release must retain:

- exact source revision, semantic version, image digest, dependency lockfiles, vulnerability results, test results, and migration head;
- configuration review showing that production fail-closed checks pass without development defaults;
- backup and rollback confirmation for the target environment;
- approval for model versions, document parsers, data flows, and external subprocessors;
- a named release owner and a timestamped go/no-go decision.

## Current readiness statement

The repository is suitable for controlled product demonstrations and engineering evaluation after its environment is configured. It must not be represented as certified, compliant, or ready for regulated production until the launch-blocking decisions above have named owners, evidence, and customer-specific approval.
