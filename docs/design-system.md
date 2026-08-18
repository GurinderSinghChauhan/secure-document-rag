# Secure Document RAG Design System

This guide defines the functional and visual standards for interfaces in Secure Document RAG. It applies to the chat experience, document administration, access-control workflows, operational screens, and future healthcare, legal, and financial modules.

The words **must**, **should**, and **may** indicate required, recommended, and optional behavior.

## Design principles

1. **Protect sensitive information:** reveal only the minimum information required for the current task.
2. **Make authorization visible:** users should understand which tenant, role, and document scope applies without exposing credentials.
3. **Prefer clarity over novelty:** use familiar controls, plain language, and predictable placement.
4. **Make system state explicit:** processing, success, partial completion, failure, and denied access must never look the same.
5. **Support verification:** distinguish generated answers from source documents and make consequential actions reviewable.
6. **Fail safely:** destructive, security-sensitive, or irreversible actions require explicit confirmation and actionable recovery guidance.
7. **Design accessibly:** all supported workflows must meet WCAG 2.2 AA.

## Component foundation

The current application uses semantic HTML and project-owned CSS. New interfaces should reuse the tokens and patterns in this guide rather than introduce page-specific styling.

If the UI later moves to a component framework, use an accessible component foundation such as shadcn/ui or Radix UI and preserve the semantics, tokens, and interaction requirements defined here. A library does not replace accessibility testing.

## Design tokens

All colors, spacing, type sizes, radii, and shadows must use named tokens. Components must not contain hardcoded color values.

### Color

The application uses a light theme by default because long-form reading, document review, and dense administrative workflows benefit from a bright neutral canvas. A dark theme may be added later, but it must preserve the same semantic meaning and accessibility requirements.

| Token | Reference | Purpose |
| --- | --- | --- |
| `--color-canvas` | `#f7f8fa` | Page background |
| `--color-surface` | `#ffffff` | Cards, panels, dialogs |
| `--color-surface-subtle` | `#f4f6f8` | Secondary surfaces |
| `--color-input` | `#ffffff` | Form controls |
| `--color-text` | `#172033` | Primary text |
| `--color-text-muted` | `#5d6678` | Secondary text |
| `--color-border` | `#dde2e9` | Borders and dividers |
| `--color-focus` | `#3157d5` | Focus indicator |
| `--color-action` | `#3157d5` | Primary actions |
| `--color-action-hover` | `#2849b8` | Primary action hover |
| `--color-success` | `#16845b` | Completed, healthy |
| `--color-warning` | `#a46708` | Attention, degraded |
| `--color-danger` | `#c43d4b` | Error, destructive |
| `--color-info` | `#3157d5` | Informational state |

Reference values document intent; production CSS must expose and consume named custom properties. Text and interactive states must be contrast-tested in both themes.

Color must not be the only status indicator. Pair it with text and, where useful, an icon.

### Typography

Use the system sans-serif stack for application text and a system monospace stack for identifiers and technical values. Hosted font dependencies should not be introduced unless they are served from the controlled environment.

```css
--font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
```

| Style | Size | Weight | Line height | Use |
| --- | --- | --- | --- | --- |
| Display | 30px | 650 | 1.2 | Rare landing-page heading |
| Page title | 24px | 650 | 1.25 | Screen title |
| Section title | 18px | 600 | 1.35 | Major section |
| Component title | 15px | 600 | 1.4 | Panel and dialog title |
| Body | 14px | 400 | 1.55 | Primary content |
| Label | 13px | 600 | 1.4 | Form and control label |
| Meta | 12px | 400 | 1.45 | Timestamp, hint, status detail |
| Code | 13px | 400 | 1.5 | Tenant IDs, hashes, model names |

Body text must remain at least 14px. Browser zoom up to 200% must not hide content or prevent task completion.

### Spacing

Use a four-pixel base scale.

| Token | Value | Typical use |
| --- | --- | --- |
| `--space-1` | 4px | Icon-to-label separation |
| `--space-2` | 8px | Compact internal gap |
| `--space-3` | 12px | Control and component gap |
| `--space-4` | 16px | Standard padding |
| `--space-5` | 20px | Card padding |
| `--space-6` | 24px | Section separation |
| `--space-8` | 32px | Page-level separation |
| `--space-10` | 40px | Large layout separation |

### Shape and elevation

| Element | Radius | Elevation |
| --- | --- | --- |
| Inputs and buttons | 8px | None |
| Cards and messages | 12px | None |
| Dialogs and menus | 12px | One subtle shadow |
| Status badges | 999px | None |

Borders define normal surface hierarchy. Shadows are reserved for overlays that visually sit above the page.

## Layout

### Application shell

- Content width must not exceed 1200px for administrative screens.
- Reading and chat content should remain between 720px and 920px.
- Page gutters are 32px on desktop, 24px on tablet, and 16px on mobile.
- Primary navigation, tenant context, and user controls must occupy stable locations.
- Dense administration screens may use a sidebar between 224px and 256px.

### Responsive behavior

| Breakpoint | Width | Behavior |
| --- | --- | --- |
| Mobile | Below 640px | Single column; full-width actions where useful |
| Tablet | 640–1023px | Single or compact two-column layout |
| Desktop | 1024px and above | Full navigation and multi-column administration |

Reflow content rather than shrink it. Tables must become horizontally scrollable or switch to labeled rows. Critical actions must not be available only on hover.

## Core components

### Buttons

- Use one primary action per task region.
- Secondary actions use an outline or neutral treatment.
- Destructive actions use the danger treatment and explicit verbs such as **Delete document**.
- Buttons must have a minimum 40px height and a 44px minimum touch target.
- Loading buttons retain their label context, show progress, and prevent duplicate submission.
- Disabled controls must have an adjacent explanation when the reason is not obvious.

### Form controls

- Every input must have a persistent visible label.
- Placeholder text is an example, not a label.
- Required fields must be identified in text.
- Validation occurs after interaction and again on submission.
- Error text must describe the problem and how to fix it.
- Sensitive values such as passwords, recovery links, and tokens must never be copied into logs or persistent browser storage.

### Cards and panels

- Use cards to group one related task or information set.
- Avoid card nesting. Use headings and dividers inside a card.
- A card must not be clickable as a whole when it also contains independent interactive controls.

### Status badges

Use a badge only for short state labels.

| Meaning | Approved labels | Semantic color |
| --- | --- | --- |
| Available | `Ready`, `Healthy`, `Indexed` | Success |
| In progress | `Uploading`, `Parsing`, `Indexing`, `Generating` | Info |
| Attention | `Degraded`, `Review required`, `Expiring` | Warning |
| Failure | `Failed`, `Unavailable`, `Rejected` | Danger |
| Access | `Restricted`, `Admin only` | Neutral |
| Lifecycle | `Deleted`, `Archived`, `On legal hold` | Neutral or warning |

Do not use vague labels such as `Bad`, `Broken`, or `Done`.

### Tables

- Headers must describe the data, not the implementation.
- Identifier, version, hash, and model columns use the monospace font.
- Sorting state must be exposed visually and to assistive technology.
- Pagination must preserve filters and provide the result count.
- Row actions use explicit labels; destructive actions must not be the default action.
- Empty tables explain whether there is no data or filters excluded all results.

### Dialogs

- Use dialogs for short, focused decisions, not multi-step workflows.
- Initial focus moves inside the dialog and returns to the trigger on close.
- Escape closes non-destructive dialogs.
- Destructive confirmation states the object, scope, and consequence.
- Legal-hold or retention restrictions must block deletion rather than merely warn.

### Notifications

- Inline feedback is preferred when it belongs to a specific form or object.
- Toasts are for non-critical confirmation and must remain long enough to read.
- Critical errors remain visible until resolved or dismissed.
- Never expose document contents, prompts, credentials, stack traces, or internal hostnames in notifications.

### Chat messages

- User and assistant messages must be visually and semantically distinct.
- Generated text must be identified as an assistant response.
- While an answer is being generated, announce progress through a polite live region.
- A failed request must preserve the user's question and provide a retry action.
- The interface must distinguish “no authorized information found” from a service failure.
- If citations return in the future, they must be expandable, keyboard accessible, and limited to documents the user is authorized to access.
- The product must not imply that an answer is professional medical, legal, or financial advice.

### Document upload

- Show accepted formats, maximum size, and access scope before upload.
- Present parsing, malware scan, chunking, embedding, and indexing as distinct states when those services exist.
- Do not claim success until the document is searchable.
- Duplicate, encrypted, malformed, unsupported, and unauthorized files require different error messages.
- Show the effective tenant, roles, and users before indexing.
- The final confirmation must include document name, status, and applied access policy without displaying document contents.

## Functional patterns

### Authentication and tenant context

- Production authentication must use SSO or short-lived sessions.
- Tenant context must be visible on every authenticated screen.
- Switching tenant context requires explicit action and clears tenant-scoped transient state.
- Authentication failures must not reveal whether another tenant, user, or document exists.
- Session expiration preserves non-sensitive draft text only when policy permits it.

### Authorization

- Hide actions users cannot perform when their absence does not create confusion.
- When a visible action is denied, explain the required role without exposing protected resource details.
- Access-denied, not-found, and no-result states must remain distinguishable internally even when the external response is intentionally generalized.

### Destructive actions

Deleting a document must show:

1. The exact document name.
2. The tenant affected.
3. Whether legal hold or retention policy blocks deletion.
4. What metadata or audit records remain.
5. A typed or explicit confirmation for high-impact deletion.

### Audit and activity

- Use past-tense action labels: `Document indexed`, `Access policy changed`, `Query completed`.
- Show actor, timestamp with timezone, tenant, action, object, and outcome.
- Audit views must never display full prompts, answers, document chunks, or credentials.
- Export actions must state scope, format, retention classification, and authorization requirements.

## System states

Every data-driven surface must define these states:

| State | Required behavior |
| --- | --- |
| Loading | Preserve layout; describe the operation |
| Empty | Explain why it is empty and offer a valid next action |
| Success | Confirm what changed and its effective scope |
| Validation error | Attach guidance to the affected field |
| Permission denied | Explain allowed next steps without leaking resource data |
| Partial failure | Identify completed and incomplete work |
| Service unavailable | Identify the unavailable capability and provide retry guidance |
| Timeout | Preserve safe user input and offer retry |
| Offline | Prevent actions that cannot complete safely |

## Accessibility

- Meet WCAG 2.2 AA for supported screens and workflows.
- All controls must work with keyboard-only input.
- Focus indicators must be clearly visible and at least 2 CSS pixels thick.
- DOM order and visual order must match.
- Headings must form a logical hierarchy.
- Icon-only controls require accessible names and visible tooltips.
- Status updates must use appropriate live regions without repeatedly interrupting users.
- Motion must respect `prefers-reduced-motion`.
- Touch targets should be at least 44 by 44 CSS pixels.
- Automated accessibility checks must be complemented by keyboard and screen-reader testing.

## Content standards

- Use sentence case.
- Prefer direct verbs: **Upload document**, **Index document**, **Ask question**.
- Avoid unexplained acronyms in user-facing content.
- Use `you` for user actions and name the system only when ownership matters.
- Do not use reassuring claims such as “secure,” “compliant,” or “private” as proof of a control.
- State uncertainty and limitations explicitly.
- Dates must include an unambiguous format; audit views include timezone.
- File sizes use consistent units. Durations use human-readable units.

## Privacy and regulated-data rules

- Do not place protected or confidential information in page titles, URLs, analytics, browser storage, or client-side logs.
- Mask secrets by default and never repopulate them after navigation.
- Do not use third-party fonts, analytics, support widgets, or error reporting without an approved data-flow review.
- Prevent sensitive content from appearing in notification previews where deployment policy requires it.
- Clear tenant-scoped UI state on logout and tenant switch.
- Display classification, retention, and legal-hold labels when supplied by policy services.
- Screenshots, exports, printing, and clipboard behavior must follow organizational policy; the UI must not claim to enforce controls that only the operating system can enforce.

## Navigation model

As the application expands, use these top-level areas:

| Area | Purpose |
| --- | --- |
| `Ask` | Query authorized documents |
| `Documents` | Upload, inspect, classify, and manage lifecycle |
| `Access` | Manage roles, users, and document policies |
| `Activity` | Review metadata-only audit events |
| `Operations` | Monitor indexing and self-hosted dependencies |
| `Settings` | Configure tenant-safe application behavior |

Do not duplicate the same information across areas. Link to the authoritative view.

## Review checklist

Before merging a UI change, verify:

- Tokens are used instead of component-specific values.
- Keyboard, focus, zoom, and screen-reader behavior work.
- Loading, empty, denied, failed, timeout, and success states exist.
- Sensitive data does not enter URLs, storage, telemetry, or errors.
- Tenant and access scope are visible where decisions depend on them.
- Destructive actions communicate scope and consequences.
- Responsive behavior works at 320px, 768px, and 1280px widths.
- Copy uses approved state language and does not make unsupported compliance claims.
- The workflow has been reviewed by security and domain owners when it changes regulated-data handling.
