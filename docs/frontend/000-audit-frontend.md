# Frontend Audit (v1.0.1)

Audit performed 2026-07-02 covering `cmd/dcrdata/public/` (JS, SCSS) and `cmd/dcrdata/views/` (Go
templates). Backend Go and database code is out of scope.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Hotwired Stimulus 3 |
| Navigation | Hotwired Turbo 8 |
| Bundle | Webpack 5 (3 configs: common / dev / prod) |
| Transpile | Babel (`@babel/preset-env`, dynamic-import plugin) |
| Charts | uPlot 1.x |
| CSS | Bootstrap 5 SCSS + Sass (dart-sass) |
| WebSocket | Partysocket (ReconnectingWebSocket wrapper) |
| Lint | ESLint 9 (flat config) + Prettier + Stylelint |
| Test | Vitest 4 (jsdom environment) |
| Vendored | `mousetrap-pause.js`, `socket.io.slim.js`, `tippy.all.js` |

## Modules

Counts are source files only (test and vendor files excluded).

| Area | Source files | With test file |
|------|-------------|----------------|
| Controllers | 27 | 17 |
| Helpers | 20 | 11 |
| Services | 5 | 2 |
| Chart definitions | 16 | 16 |
| SCSS partials | 29 | — |

## Files needing attention

### Bug hazards

- `public/js/helpers/mempool_helper.js:125` — `isQuestionableVote` returns `undefined` (implicit)
  on the fallthrough path (line 132): when `tx.Type === 'Vote'`, `vote_info.last_block` is truthy,
  and no matching spent ticket is found in the loop. The `return false` on line 126 (non-vote case)
  is correct. Works because `undefined` is falsy, but any early-return refactor or `&&`-chain could
  break silently.
- `public/js/controllers/homepage_controller.js:178` — `updateCoinFillBars` builds HTML via
  template literals with user-facing values. No DOMPurify.
- `public/js/helpers/humanize_helper.js:36` — `decimalParts` builds HTML strings with label values.
  No DOMPurify.
- `public/js/helpers/humanize_helper.js:167` — `skaCoinValue` converts BigInt → Number to pass to
  `threeSigFigs`. Lossy above 2^53 atoms. Mitigated: only used for 3-sig-fig display, not core
  accounting.

### Test gaps

**Controllers without tests:**

| Controller | File | Lines |
|------------|------|-------|
| `agendas` | `agendas_controller.js` | — |
| `attackcost` | `attackcost_controller.js` | — |
| `clipboard` | `clipboard_controller.js` | 26 |
| `menu` | `menu_controller.js` | 48 |
| `pagenavigation` | `pagenavigation_controller.js` | 42 |
| `rawtx` | `rawtx_controller.js` | — |
| `search` | `search_controller.js` | 14 |
| `status` | `status_controller.js` | — |
| `sticky_col` | `sticky_col_controller.js` | — |
| `supply` | `supply_controller.js` | — |

**Helpers without tests:**

`animation_helper`, `block_helper`, `http`, `live_block_table`, `mempool_helper`, `meters`,
`module_helper`, `turbo_helper`, `zoom_helper`

**Services without tests:**

`cookie_service`, `keyboard_navigation_service`, `theme_service`

### Monoliths

| File | Lines | Responsibility |
|------|-------|---------------|
| `address_controller.js` | 913 | Address page: charts, tables, pagination, QR, expand |
| `charts_controller.js` | 612 | Charts page: select, fetch, render, zoom, visibility |
| `humanize_helper.js` | 307 | 15+ formatting functions (time, amounts, hashes, bytes) |
| `homepage_controller.js` | 277 | Home: mempool, indicators, blocks, reconnection |
| `chart_panel.js` | 491 | Chart lifecycle manager (standalone, already clean) |
| `meters.js` | 440 | Canvas-based gauge meters (legacy, not well tested) |

### Dead / deprecated

- *(None identified — all vendor files are actively referenced.)*

### Build config

- `webpack.common.cjs` runs `CleanWebpackPlugin` and `StyleLintPlugin` in dev too. Stylelint should
  be dev-only; CleanWebpackPlugin is only useful for prod.
- `webpack.common.cjs` sets `chunkIds: 'natural'` — `deterministic` is the webpack 5 default and
  yields better long-term caching.

### CSS

- Dark mode uses `body.darkBG` selector with 200+ lines of overrides in `themes.scss`. Bootstrap 5.3
  has native `data-bs-theme` support. Migration would drop most of these.
- `responsive.scss` is minimal (only 3 breakpoints). Some pages (address, charts) may not be fully
  responsive at very narrow widths.
- CSS custom properties for mempool status tokens are defined on `:root` and `body.darkBG` via
  selector specificity rather than a single theme attribute.
