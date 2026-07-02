# Stage 4 — Dark mode → `data-bs-theme`

**Effort**: Medium · **Parallelizable**: No · **Depends on**: Stage 3 recommended (smaller merge
conflict surface)

Replace the hand-rolled `body.darkBG` class paradigm with Bootstrap 5.3's native
`data-bs-theme="dark"` attribute.

---

## Tasks

### 4.1 Update `theme_service.js`

- Toggle `data-bs-theme="dark"` on `<html>` instead of `darkBG` class on `<body>`
- Remove cookie-based persistence? Keep cookie for SSR — the server needs to know the theme to
  render the initial HTML. `data-bs-theme` is client-only.
- Update `darkEnabled()` to read the attribute instead of the cookie (or keep both: cookie for SSR,
  attribute for CSS)

### 4.2 Strip `body.darkBG` from SCSS

**File**: `public/scss/themes.scss`

Replace every `body.darkBG` selector with `[data-bs-theme="dark"]`. Bootstrap 5.3's built-in dark
mode variables handle most text/background/link colors — drop overrides that Bootstrap now covers
natively.

### 4.3 Audit all `darkEnabled()` callers

Search for uses of `darkEnabled()` in controllers and helpers:

- `chart_panel.js` — theme toggling (should still work, just reads different source)
- `tx_controller.js` — approval meter dark mode
- Any other consumer

### 4.4 Verify both themes

- Check every page: home, address, tx, block, blocks, charts, mempool, ticketpool, agendas,
  proposals, attackcost, hashrate_shares, parameters, sidechains, visualblocks
- Check chart rendering (uPlot theme integration)
- Check mempool status token colors (CSS custom properties)
