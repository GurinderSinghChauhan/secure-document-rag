# Frontend architecture

## Decision

The former static pages are one client-side application with route-composed, feature-first modules. `/`, `/ask`, `/admin`, and `/super-admin` resolve to a shared SPA entrypoint. The homepage composes the document-intelligence dashboard, while `/ask` owns chat. Route guards improve navigation and prevent accidental exposure, while FastAPI remains authoritative for every protected action.

## Dependency direction

```text
main -> app -> routes -> features -> api
                    |          -> components/ui
                    +----------> components/layout
```

Dependencies point toward stable, lower-level modules. Shared components cannot import business features, features cannot import routes, and route modules should contain composition rather than request logic.

## State ownership

| State | Owner |
| --- | --- |
| API data, caching, invalidation, polling | TanStack Query |
| Access token and authenticated user | Memory-only auth provider |
| Refresh token | Secure HttpOnly cookie managed by FastAPI |
| Filters or tabs worth linking to | URL search parameters |
| Form drafts, dialogs, selections | Closest React component |
| Streaming and upload progress | Domain-specific service and feature state |

Dashboard data is server-aggregated from tenant-scoped document metadata and filtered through each document's role and explicit-user ACL before it reaches the browser. The client owns only the selected industry and progressive-disclosure state; it never receives unauthorized document summaries.

The API client performs one coordinated refresh, retries one unauthorized request, and clears the in-memory session when refresh fails. Tokens must never be written to local or session storage.

## Production integration

Vite emits a hashed application bundle under `app/static/spa`. FastAPI serves the same HTML for each application route, uses `no-store` for HTML and API responses, and permits one-year immutable caching only for hashed bundle assets. Docker builds the frontend in a Node stage and copies only generated files into the final Python image.

## Testing

- TypeScript strict mode validates contracts and nullability.
- ESLint validates hooks and unsafe TypeScript operations.
- Vitest and Testing Library validate user-visible component behavior.
- MSW provides controlled API boundaries.
- Playwright validates direct routing and critical browser workflows.
- Python tests validate server routing, architecture invariants, and backend regression behavior.

## Migration constraints

Backend routes and payloads remain unchanged. The migration preserves chat history, streaming responses, voice input, account action links, document upload progress, compute guardrails and polling, indexed-document deletion, members and invitations, trial controls, platform access management, and response evaluation.
