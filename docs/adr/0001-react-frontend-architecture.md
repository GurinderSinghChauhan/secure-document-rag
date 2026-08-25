# ADR 0001: Route-composed React frontend

- Status: Accepted
- Date: 2026-08-25

## Context

Ask, Admin, and Platform Admin were independent HTML and JavaScript documents. Navigation reloaded the browser, restored authentication repeatedly, and duplicated application shell and request behavior.

## Decision

Use React with TypeScript and Vite, React Router for URL boundaries, TanStack Query for server state, and Radix primitives for complex accessible interactions. Organize code by business feature, keep route modules thin, maintain the project-owned design tokens, and retain FastAPI as the only authorization authority.

## Consequences

- Internal navigation shares one memory-only authenticated session.
- Route bundles load independently.
- Business behavior is colocated with its API operations and tests.
- Frontend validation and a Node build become required CI and Docker stages.
- A frontend build is required before running the production server from a source checkout.
