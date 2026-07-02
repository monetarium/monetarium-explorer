# Stage 1 — Bugfixes & quick cleanup

**Effort**: Small · **Parallelizable**: Yes · **Depends on**: Nothing

Fixes correctness bugs and build hygiene issues identified in the [audit](000-audit-frontend.md).

---

## Tasks

### 1.1 Fix `isQuestionableVote` missing return

**File**: `public/js/helpers/mempool_helper.js:125`

The function returns `undefined` (implicit) when `tx.Type !== 'Vote'`. Add explicit `return false`.

### 1.2 Sanitize `updateCoinFillBars` HTML

**File**: `public/js/controllers/homepage_controller.js:178`

Template-literal HTML with user-facing values (`symbol`, `fill_pct`, `status`). Wrap with
`dompurify.sanitize()`. `dompurify` is already a dependency.

### 1.3 Sanitize `humanize.decimalParts` HTML

**File**: `public/js/helpers/humanize_helper.js:36`

Returns raw HTML strings consumed via `innerHTML`. The values come from the server (not user input)
so the risk is low, but the function accepts arbitrary `v`/`precision` from callers, and the
Bootstrap/CSS-class scaffolding embedded in the HTML should not splat unsanitized content. Wrap
output with a `dompurify.sanitize()` call at the boundary.

### 1.4 Move `stylelint-webpack-plugin` to dev config

**File**: `webpack.common.cjs`

StyleLintPlugin runs on every prod build, adding ~2-3s of unnecessary lint time. Move it to
`webpack.dev.cjs` only.

### 1.5 Move `CleanWebpackPlugin` to prod config

**File**: `webpack.common.cjs`

CleanWebpackPlugin is only useful before a production build (cleans stale chunks). In development
the watch rebuilds incrementally; clearing `dist/` on every compile breaks the dev experience and
serves no purpose. Move to `webpack.prod.cjs`.

### 1.6 Switch `chunkIds` to `deterministic`

**File**: `webpack.common.cjs:12`

`chunkIds: 'natural'` → `'deterministic'`. Better long-term caching (the webpack 5 default).
