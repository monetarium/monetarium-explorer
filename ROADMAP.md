# Monetarium Explorer — Frontend Roadmap

> **Status**: Live at v1.0.1.
> This document captures the high-stroke improvement plan for the frontend codebase only. Each
> stage is specified and tasked in its own document under `docs/frontend/` — open a linked doc
> before working on any stage.

---

## Current state

Built on **Stimulus 3 + Turbo + Webpack 5 + Bootstrap 5 + uPlot + Partysocket + Vitest**.

| Metric | Count |
|--------|-------|
| Controllers | 27 |
| Helpers | 20 |
| Services | 5 |
| Chart definitions | 16 |
| JavaScript files (excl. test/vendor) | ~71 |
| SCSS partials | 29 |
| Go HTML templates | 31 |
| CI/CD | GitHub Actions: Go build/test ×2, `npm run check`→`test`→`build`, Docker publish |

**Known gaps** (from [v1.0.1 audit](docs/frontend/000-audit-frontend.md)):

- No TypeScript — biggest quality leverage
- `isQuestionableVote` returns `undefined` instead of `false`
- HTML-string builders lack DOMPurify (`updateCoinFillBars`, `decimalParts`)
- 10 controllers, 9 helpers, 3 services with zero tests
- `address_controller` at 913 lines, `charts_controller` at 612, `humanize_helper` at 307
- Dark mode via 200+ lines of `body.darkBG` CSS overrides (not using `data-bs-theme`)
- `stylelint-webpack-plugin` in prod config (slows builds)
- No user-facing error toast/banner

---

## Stages

Each stage delivers a coherent, independently shippable improvement. Stages build on each
other only when stated — most can be worked in parallel after Stage 1.

| Stage | Theme | Est. effort | Depends on |
|-------|-------|-------------|------------|
| [1](docs/frontend/001-bugfixes-and-cleanup.md) | Bugfixes & quick cleanup | Small | — |
| [2](docs/frontend/002-test-coverage.md) | Test gap closure | Medium | — |
| [3](docs/frontend/003-split-monoliths.md) | Split monoliths | Medium | Stage 2 (safety net) |
| [4](docs/frontend/004-dark-mode-migration.md) | Dark mode → `data-bs-theme` | Medium | Stage 3 (reduced merge conflict surface) |
| [5](docs/frontend/005-ux-polish.md) | UX polish | Medium | — |
| [6](docs/frontend/006-typescript.md) | TypeScript (optional) | Large | Stage 3 (structure settled) |

### Stage 1 — Bugfixes & quick cleanup

Small, isolated fixes that improve correctness and build hygiene immediately.

- Fix `isQuestionableVote` missing `return false`
- Sanitize `updateCoinFillBars` HTML injection
- Sanitize `humanize.decimalParts` HTML output
- Move `stylelint-webpack-plugin` to dev config only
- Move `CleanWebpackPlugin` to prod config only

### Stage 2 — Test gap closure

Add tests for every untested module, ordered from pure-function helpers up to complex controllers.

- Pure helpers: `http`, `zoom_helper`, `animation_helper`, `block_helper`, `module_helper`, `turbo_helper`, `mempool_helper`
- Services: `cookie_service`, `theme_service`, `keyboard_navigation_service`
- Simple controllers: `clipboard`, `search`, `menu`, `status`, `sticky_col`, `rawtx`, `pagenavigation`
- Complex controllers: `supply`, `attackcost`, `agendas`

### Stage 3 — Split monoliths

Break the largest files into focused units so each module has one clear responsibility.

- Split `humanize_helper` into `time_helper`, `format_helper`, `hash_helper`, `coin_helper`
- Extract chart-definition / data-fetching logic from `address_controller` (913 lines)
- Extract zoom/range/resize helpers from `charts_controller` (612 lines)
- Extract mempool rendering and indicator logic from `homepage_controller` (277 lines)

### Stage 4 — Dark mode → `data-bs-theme`

Replace the hand-rolled `body.darkBG` class paradigm with Bootstrap 5's native
`data-bs-theme="dark"` attribute.

- Drop ~200 lines of override CSS from `themes.scss`
- Update `theme_service.js` toggling logic
- Verify every view renders correctly in both modes

### Stage 5 — UX polish

Surface errors and loading states to the user. Improve accessibility and resilience.

- Error toast/banner component (errors currently go to console only)
- `requestJSON` with timeout, retry, `AbortController`
- Loading skeleton pattern (currently just `.loading` spinner)
- Accessibility: focus management in pagination, contrast audit, screen-reader labels on charts

### Stage 6 — TypeScript (optional)

**Decision point: full TS migration vs lighter JSDoc typing.**

- Full TS: webpack config changes, `ts-loader`, retype ~71 source files
- JSDoc: no build change, catches type errors via `tsc --noEmit`, works with existing Babel/ESLint

Not committing to this yet — revisit after Stage 3 when the module structure is settled.

---

## Maintenance

- Each stage doc lives at `docs/frontend/STAGE-NAME.md`
- When stage is complete, add a ✓ at the top of this table
- If scope drifts during a stage, update its doc and note the delta here
