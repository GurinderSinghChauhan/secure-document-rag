# Frontend

The application UI is a React, TypeScript, Vite, React Router, TanStack Query, and Radix SPA. FastAPI continues to own authentication, authorization, APIs, and production asset serving.

## Commands

```bash
npm ci
npm run dev
npm run check
npm run test:e2e
```

The development server proxies `/v1`, `/healthz`, and `/readyz` to `127.0.0.1:8080`. A production build is written to `app/static/spa`; generated output is intentionally not committed.

## Boundaries

- `app/` composes global providers, routing, and route-level failure handling.
- `routes/` declares URL boundaries and composes domain features.
- `features/` owns business workflows, API operations, state hooks, components, and colocated tests.
- `components/ui/` contains business-neutral controls. Accessible primitives are wrapped here rather than imported throughout features.
- `components/layout/` contains the shared shell and other structural components.
- `api/` owns transport behavior, authentication retry, shared contracts, and generated API types.
- `test/` owns shared test rendering and network mocks.

Routes may import feature public APIs. Features must not import routes. Cross-feature imports should use the feature's `index.ts`; shared code is promoted only after it has more than one real consumer.

Server data belongs in TanStack Query, shareable navigation state belongs in the URL, authentication belongs in the auth provider, and transient interaction state remains local. Do not add another global state library without a documented cross-feature requirement.

## Adding functionality

1. Extend the closest existing domain under `features/`; create a new domain only when the concepts and API lifecycle are genuinely independent.
2. Export the supported surface from that feature's `index.ts`.
3. Compose it in a route without moving business logic into the route module.
4. Test user-visible behavior and error states. Use MSW for API boundaries and Playwright for critical navigation flows.
5. Run `npm run check` before handoff.
