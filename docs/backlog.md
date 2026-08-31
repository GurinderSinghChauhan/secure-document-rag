# Product Backlog

## Frontend single-page application migration

**Status:** Implemented on `feature/ui-framework-refactor`

Migrate the static multi-page frontend to a React application built with Vite and React Router. Keep FastAPI and the existing API contracts unchanged.

### Motivation

Ask, Admin, and Platform Admin are currently separate HTML pages. Moving between them performs a full browser navigation, restores the session again, and reloads page-specific state. A shared client application would provide seamless navigation and centralized authentication state.

### Scope

- Create one shared application shell for Ask, Admin, and Platform Admin.
- Add client-side routes and role-aware route guards.
- Keep the access JWT in memory and restore the session once on application startup.
- Reuse shared account, organization, navigation, loading, and error components.
- Preserve streaming chat, multi-file upload progress, compute polling, invitations, member management, trial status, and super-admin controls.
- Preserve server-side authorization for every protected operation.
- Retain the current responsive design and accessibility behavior.

### Acceptance criteria

- Navigating between application sections does not reload the document or flash the login screen.
- Session refresh is not repeated for every internal route change.
- Members, admins, and super-admins see only permitted navigation and routes.
- Direct route loading and browser back/forward navigation work correctly.
- Existing backend and browser tests continue to pass, with added SPA navigation coverage.
