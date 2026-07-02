# Stage 5 — UX polish

**Effort**: Medium · **Parallelizable**: Yes · **Depends on**: Nothing

Surface errors, loading states, and accessibility improvements to the user.

---

## Tasks

### 5.1 Error toast/banner

Design a non-intrusive toast or banner for user-facing errors (network failures, server errors,
fetch timeouts). Currently all errors go to `console.*` only.

- Stimulus controller for the toast component
- Global event `SHOW_ERROR` on the event bus
- Auto-dismiss after N seconds
- Include in layout template (`extras.tmpl` or similar)

### 5.2 `requestJSON` resilience

**File**: `public/js/helpers/http.js`

- Add configurable timeout (default 15s)
- Add retry (1 retry with backoff for 5xx)
- Accept `AbortController` signal for cancellation

### 5.3 Loading skeleton pattern

Currently pages show a `.loading` class that triggers a spinner overlay. Add a skeleton/shimmer
pattern for content sections so the page feels responsive immediately.

- Identify sections where spinners are used (charts: `chartLoader`, tables: `listLoader`)
- Replace spinner with content-shaped skeleton

### 5.4 Accessibility

- **Focus management**: pagination page links, zoom/bin button groups (roving tabindex?)
- **Color contrast**: audit light and dark modes against WCAG AA
- **Screen reader labels**: charts need aria-label/description, mempool tables need scope on headers
- **Keyboard nav**: `keyboard_navigation_service` exists — verify coverage on all interactive pages
