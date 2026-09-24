# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include customer data, credentials, exploit details, or document contents in a report.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/GurinderSinghChauhan/secure-document-rag/security/advisories/new>

Include the affected version, deployment model, reproduction steps using synthetic data, and the potential impact. The project owner should acknowledge a complete report within two business days, provide a triage decision within five business days, and coordinate disclosure after a fix is available. These targets are response goals, not a contractual service-level agreement.

## Supported versions

Security fixes are applied to the latest released version. Older development snapshots and untagged images are not supported. Deploy released images by immutable digest and retain the source revision shown by the application.

## Deployment responsibility

The application fails closed on several production security settings, but deployers remain responsible for TLS termination, secret management, backups, monitoring, identity-provider controls, network policy, data retention, and customer-specific regulatory obligations. Review [Product readiness](docs/product-readiness.md) before processing customer data.
