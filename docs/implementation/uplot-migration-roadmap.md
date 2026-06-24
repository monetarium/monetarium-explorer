# Dygraphs → uPlot Chart Migration — Roadmap

> **Status:** Roadmap / parent spec. This is the **decomposition + shared-interface contract**, not an
> executable plan. Each PR below gets its own bite-sized TDD plan written *just-in-time* via the
> `superpowers:writing-plans` skill, then executed via `superpowers:subagent-driven-development`.
> **Do not write the detailed surface plans (PR 1–6) until the Foundation (PR 0) is built and its
> interfaces are proven** — they depend on the real adapter/definition API.

**Goal:** Replace the vendored Dygraphs library with uPlot across all five live Cartesian chart surfaces,
behind one shared rendering layer, with no change to backend, DB, or the money representation.

**Architecture:** Introduce a thin **chart foundation** (`chart_theme.js` design tokens + `uplot_adapter.js`
render/sync API + a per-chart **definition** contract). Each page controller stops talking to Dygraphs
directly and instead declares *definitions* and drives them through the adapter. The big
`charts_controller.js` (1,172 lines) decomposes into a **page shell** (control bar + URL state + lifecycle)
plus a **chart registry** of definitions.

**Tech stack:** uPlot (`uplot` npm dep, dynamic-imported for code-splitting), Hotwired Stimulus
controllers, Webpack, vitest + jsdom, SCSS. No React.

---

## Global Constraints

These apply to **every** PR below. Copied/derived from `CLAUDE.md` and recorded user preferences.

- **Library delivery:** add `uplot` as an npm **dependency** (current `^1.6.32`); load it lazily via the
  existing `getDefault(import(/* webpackChunkName: "uplot" */ 'uplot'))` pattern
  (`public/js/helpers/module_helper.js`). Do **not** vendor a minified copy.
- **SKA precision is sacred.** VAR has 8 decimals and rides `float64` safely. **SKA has 18 decimals and
  exceeds `float64`** — SKA atom values must stay as `big.Int`-derived **strings** end-to-end. For charts
  this means a hard split: a **plot value** (a `number`, fine to lose sub-pixel precision — a canvas can't
  show 18 sig-digits anyway) is separate from a **display value** (the exact string shown in
  tooltip/legend, formatted via `splitSkaAtomsNoTrailing` / `formatSkaAtomsExact`). Never `Number()` a SKA
  atom string for display. See **Contract C: ChartDefinition.formatValue**.
- **Multi-coin:** `/charts` enumerates `coin-supply/0` (VAR) + `coin-supply/{n}` and `fees` + `fees/{n}`
  for each active SKA type. Definitions must be parameterizable by coin type, not hard-coded.
- **Compute server-side.** Charts render data the API already returns; do not move money math into JS.
  JS only reshapes API columns into uPlot's data format and formats for display.
- **PR title format:** `cmd/dcrdata: <concise description>`.
- **Branching/commits:** branch off `origin/develop` with `--no-track`; **separate commits per logical
  change**; keep local-only (testnet) commits off PR branches. Each surface PR is **stacked**
  (`gh pr create --base <previous-branch>`) and the stack merges as a unit (see *Release coherence*).
- **Green before commit:** `npm run check` (prettier + eslint + stylelint) and `npm test` (vitest) must
  pass; the pre-commit hook runs prettier/eslint/stylelint/vitest on staged JS. No `--no-verify`, no
  `--amend`.
- **Don't rename legacy `dcrd`/`dcrdata` paths/identifiers** — they're load-bearing.

### Release coherence (the §3.3 "no half-migrated look" rule)

§3.3 forbids users seeing uPlot and Dygraphs charts side by side with different tooltips/zoom/styling.
Reconcile with incremental review like this:

- **Within a page** (`/charts` has ~17 series sharing one control bar): migrate **atomically** — one PR,
  all series at once. Never ship a page half-migrated.
- **Across pages:** stack PR 1–6 on the Foundation branch and **merge the stack together** (or in one tight
  window) so a release never contains both engines. PR 7 (delete Dygraphs) is the gate that proves the
  stack is complete.

---

## Shared Interface Contracts (defined by PR 0, consumed by PR 1–6)

These three contracts are the whole reason the roadmap exists. Lock them in the Foundation; every surface
plan implements against them verbatim. Signatures are the **contract**, not final code — PR 0's detailed
plan refines bodies, but later plans rely on these names/types.

### Contract A — Design tokens: `public/js/helpers/chart_theme.js`

Re-homes the categorical palette currently living in `hashrate_shares_controller.js` so the SVG pie and the
uPlot charts share **one** source of truth.

```js
// Moved verbatim from hashrate_shares_controller.js (which then imports from here):
export const PALETTE          // 25-entry categorical palette (light+dark safe)
export const OTHERS_COLOR     // '#adb5bd'
export function colorForIndex(i)   // PALETTE[i % PALETTE.length]
export function swatchColor(rank)  // 1-based rank -> slice color or OTHERS_COLOR

// New, theme-aware (driven by services/theme_service.darkEnabled()):
export function chartColors(dark)  // -> { axis, grid, label, crosshair, tooltipBg, tooltipText }
export function seriesStroke(i)    // -> palette stroke for series i
export function seriesFill(i, dark) // -> translucent fill for area/bar series i
```

PR 0 **moves** `PALETTE`/`OTHERS_COLOR`/`colorForIndex`/`swatchColor` out of
`hashrate_shares_controller.js` into `chart_theme.js`, and updates `hashrate_shares_controller.js` +
`hashrate_shares_controller.test.js` to import them. (The SVG pie keeps rendering itself — it does **not**
become a uPlot chart; it only shares tokens.)

### Contract B — uPlot adapter: `public/js/helpers/uplot_adapter.js`

Wraps uPlot so controllers never touch its raw API. Replaces the Dygraphs instantiation and
`chart_helper.synchronize`.

```js
// el: HTMLElement, def: ChartDefinition (Contract C), opts: { dark, width, height }
export function createChart(el, def, opts) // -> ChartHandle

// ChartHandle:
//   setData(columns)            columns: number[][] = [xs, ...ys] (uPlot data format)
//   setScaleType('linear'|'log')
//   setMode('line'|'stepped')
//   setVisibility(map)          map: { [seriesLabel]: boolean }
//   resize(width, height)
//   destroy()                   MUST be called on Stimulus disconnect (Turbolinks nav)
//   uplot                       escape hatch to the raw instance

// Replaces chart_helper.synchronize(dygraphs, {zoom, selection}):
export function syncCharts(handles, { zoom, cursor }) // wraps uPlot.sync
```

Adapter responsibilities (ported from current Dygraphs config / `chart_helper.js`):
- **Row→column transform** is *not* needed at the adapter — the API already returns columns
  (`{ t:[], price:[], count:[], supply:[], fees:[], rate:[], ... }`, see the vitest http mock). Definitions
  feed columns straight in; **drop the `zipIvY`/row-zipping** the Dygraphs path used.
- **Bars / histograms** via `uPlot.paths.bars({ size, align, radius })` — replaces `barChartPlotter`,
  `sizedBarPlotter` (per-bin width), `multiColumnBarPlotter` (grouped) in `chart_helper.js`.
- **Stepped** via `uPlot.paths.stepped`; **area/fill** via series `fill` + `bands`; **stacked** via
  `bands` + cumulative columns.
- **Dual Y-axis** via `scales.y2` + `axes[].scale:'y2'` + `series[].scale:'y2'` — replaces
  `multiYAxisChart` / `labelsMG2`.
- **Custom legend + crosshair tooltip** rendered from `chart_theme` tokens (replaces the
  `Dygraph.Plugins.Legend.generateLegendHTML` override).
- **Theme** redraw on the `NIGHT_MODE` event (the shell subscribes; adapter exposes the redraw).

### Contract C — ChartDefinition

A plain object each surface declares. This is what collapses the `isSKASupplyChart` / `isSKAFeeChart` /
`usesWindowUnits` / `multiYAxisChart` branching into data.

```js
/** @typedef {Object} ChartDefinition
 * @property {string}  name                 // e.g. 'pow-difficulty', 'coin-supply/0'
 * @property {string}  label                // legend/axis title
 * @property {Object}  controls             // which shared controls apply:
 *    { bin:boolean, scale:boolean, mode:boolean, zoom:boolean,
 *      visibility:string[]|null, interval:boolean }
 * @property {AxisSpec[]}   axes            // [yAxis] or [yAxis, y2Axis]; each { label, scale, unit }
 * @property {SeriesSpec[]} series          // { label, scale:'y'|'y2', kind:'line'|'stepped'|'area'|'bars', colorIndex }
 * @property {(settings)=>string} url       // builds the API URL from controller settings
 * @property {(raw, settings)=>number[][]} toColumns  // API payload -> [xs, ...ys] plot values
 * @property {(seriesIdx, rawDatum, settings)=>string} formatValue // EXACT display string (SKA-safe)
 */
```

`formatValue` is the precision firewall: for VAR series it formats a `number`; for SKA series it receives
the **raw atom string** and formats via the existing `ska_helper` functions — the plotted `number` in
`toColumns` is only for geometry.

### Page shell (PR 0 scaffolding, fully populated in PR 1)

`charts_controller.js` decomposes into:
- **Shell** — owns the control bar wiring (`setZoom`/`setBin`/`setScale`/`setMode`/`setVisibility`/
  `setAxis`/`setIntervalOption`), `TurboQuery` URL state (`chart/zoom/scale/bin/axis/visibility/mode`),
  theme subscription, and chart **lifecycle** (create on `selectChart`, `destroy()` on disconnect).
- **Registry** — `public/js/charts/registry.js`: `name -> ChartDefinition`, including the
  `coin-supply/{n}` and `fees/{n}` parameterized factories.

---

## PR Sequence

Each row is one stacked PR with its own `writing-plans` plan. "Atomic?" = must migrate all of its surface's
series in that single PR.

| PR | Branch (off `origin/develop`) | Scope | Files | Atomic? | User-visible |
|----|------|-------|-------|---------|--------------|
| **0 — Foundation** | `feat/uplot-foundation` | Add `uplot` dep; `chart_theme.js` (Contract A, re-home palette); `uplot_adapter.js` (Contract B); `ChartDefinition` typedef + empty registry + page-shell skeleton (Contract C). **Dygraphs untouched.** | +`helpers/chart_theme.js`, +`helpers/uplot_adapter.js`, +`charts/registry.js`, ~`hashrate_shares_controller.js`(+test), ~`package.json` | n/a | No |
| **1 — /charts** | `feat/uplot-charts-page` | Decompose `charts_controller.js` into shell + definitions; migrate **all ~17 series** atomically. Dual-axis (ticket-price, privacy-participation, hashrate), SCALE/BIN/MODE/VISIBILITY/INTERVAL, SKA supply+fees. | ~`charts_controller.js`, +`charts/definitions/*.js`, ~`charts_controller.test.js`, ~`charts.tmpl`(legend markup) | **Yes** | Yes |
| **2 — address** | `feat/uplot-address` | Amount-flow stacked area (received/sent/net) + line/fill + sized-bar histogram; series-visibility bitmap. | ~`address_controller.js`(+test), ~`address.tmpl` | Yes | Yes |
| ~~**3 — proposal**~~ | ~~`feat/uplot-proposal`~~ | **DROPPED** — `/proposal` returns HTTP 410 (Politeia proposals unused in Monetarium; see [wiki/core/pages.md](../../wiki/core/pages.md)). No live page to migrate; its dead chart code is deleted in PR 7 instead. | — | — | — |
| **4 — ticketpool** | `feat/uplot-ticketpool` | tickets-by-purchase-date (stacked bars) + tickets-by-purchase-price (bars + line overlay). | ~`ticketpool_controller.js`(+test), ~`ticketpool.tmpl` | Yes | Yes |
| **5 — agenda** | `feat/uplot-agenda` | cumulative vote choices (stacked area) + vote choices by block (bars). | ~`agenda_controller.js`, ~`agenda.tmpl` | Yes | Yes |
| **6 — attackcost** | `feat/uplot-attackcost` | single line/area; Y-zoom disabled (port the `doZoomY_` no-op intent). | ~`attackcost_controller.js`, ~`attackcost.tmpl` | Yes | Yes |
| **7 — Cleanup** | `feat/uplot-cleanup` | Delete the dead `proposal_controller.js` + `proposal.tmpl` (the `/proposal` route is 410, but the controller is auto-bundled via `webpackContext` and is the last `synchronize`/`multiColumnBarPlotter`/Dygraphs consumer); delete `vendor/dygraphs.min.js` **and the dead `vendor/charts.min.js` (Chart.js 2.7.2, unused)**; remove ported `chart_helper.js` plotters (`barChartPlotter`, `sizedBarPlotter`, `multiColumnBarPlotter`, `synchronize`, `minViewValueRange`); drop `dygraphs` webpack chunk refs. | −2 vendor files, −`proposal_controller.js`, −`proposal.tmpl`, ~`chart_helper.js` | n/a | No (bundle shrinks) |

> The **hashrate-shares SVG pie** (`hashrate_shares_controller.js`) is intentionally **absent** — it stays
> hand-rolled and only adopts `chart_theme` tokens (done in PR 0). Folding it into the migration would
> inflate scope for zero rendering-consistency gain.

---

## Per-surface inventory (what each plan must preserve)

Behaviors a fresh implementer would otherwise miss. The surface plan **characterizes each with a test
first**, then swaps the renderer.

- **/charts** — `<select>` of: `ticket-price`, `ticket-pool-size`, `ticket-pool-value`,
  `stake-participation`, `block-size`, `blockchain-size`, `tx-count`, `pow-difficulty`,
  `coin-supply/0`(+`/{n}`), `fees`(+`/{n}`), `duration-btw-blocks`, `chainwork`, `hashrate`,
  `missed-votes` (the `hashrate-shares` option is a redirect to `/hashrate-shares` — keep that).
  Dual-axis set = `['ticket-price','privacy-participation','hashrate']`. Window-unit scales =
  `['ticket-price','pow-difficulty','missed-votes']`. Line-only (SCALE disabled) =
  `['ticket-price','privacy-participation']`. Mode-enabled = `['ticket-price','hashrate']`. URL state via
  `TurboQuery`; existing `charts_controller.test.js` URL-persistence + `chart-hashrate` class tests **must
  keep passing**.
- **address** — `stackedGraph` received/sent/net + `linePlotter`/`fillPlotter` net band + `sizedBarPlotter`
  per-bin histogram; visibility bitmap maps 1 "Net" bit → two Dygraph series (preserve the mapping).
- **ticketpool** — `barChartPlotter` + `stackedGraph` (by date); bars + `linePlotter` overlay (by price);
  `padPoints` edge padding.
- **agenda** — `fillGraph`+`stackedGraph` cumulative; `barChartPlotter` by block.
- **attackcost** — `Dygraph.prototype.doZoomY_ = no-op` (lock Y); single series.

---

## Test strategy

- **Framework:** vitest + jsdom, mirroring `charts_controller.test.js` — mock the dynamically-imported
  uPlot the same way Dygraphs is mocked today (via `helpers/module_helper.getDefault`). Each surface plan
  extends that surface's existing `*.test.js`.
- **Formatters:** assert **exact output strings** (e.g. `formatValue` for a SKA atom string →
  `'12,345.678901234567890123'`), never property-only checks like "contains a comma" — boundary glitches
  (trailing dot, lost digit) hide from property tests. `fast-check` is available for generative coverage but
  **always pair it with exact-string boundary cases**.
- **Precision regression test (PR 0 + PR 1):** a SKA `formatValue` test proving an 18-decimal atom string
  round-trips to the exact display string with **no `Number()` coercion** in the path.
- **Behavior characterization:** for each surface, before swapping the renderer, add tests pinning the
  observable contract (URL persistence, visibility toggles, sync side-effects) so the swap is provably
  behavior-preserving.
- **Manual visual parity (per surface, before opening the PR):** `npm run watch`, then compare the surface
  against `develop` in **light and dark**, checking line/area/bar shape, dual-axis alignment, zoom/pan,
  crosshair tooltip, and legend.

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| SKA 18-decimal precision lost if atoms are plotted as floats for display | Contract C split: numeric **plot value** vs exact-string **display value**; precision regression test |
| Dual-axis (y/y2) range parity — the `yValueRanges`/`minViewValueRange`/`axesToRestoreYRange` logic | Port the min-range restore into the adapter; characterize with a test before swapping |
| Dark/light theming drift | All colors flow through `chart_theme.chartColors(dark)`; redraw on `NIGHT_MODE` |
| Memory leak on Turbolinks nav | `ChartHandle.destroy()` mandatory in every controller's `disconnect()` |
| Bundle size not actually improving | Verify `npm run analyze` after PR 7: Dygraphs (246 KB) + dead Chart.js (348 KB) removed, uPlot (~45 KB) added |
| `/charts` PR too large to review even when atomic | Split *internally* into per-definition commits within the one PR; the PR stays atomic, the commits stay reviewable |

---

## Out of scope (explicitly)

- Converting the hashrate-shares pie to a chart library (stays SVG).
- Pretty `/charts/{name}` URLs (separate, optional follow-up; not required by §3.3).
- Any backend, DB, API-shape, or money-math change.
- Renaming legacy `dcrd`/`dcrdata` identifiers.

---

## Next step

**Status (2026-06-23):** PR 0 (Foundation) + PR 1 (/charts) **landed together** as merged PR #515
(`feat/uplot-charts`), which also absorbed the ranger strip + mobile/touch + tooltip surface work.
PR 2 (address) plan is written → `docs/superpowers/plans/2026-06-23-uplot-pr2-address.md`
(user decisions: include the ranger strip; faithful stacked bars). Remaining: PR 2 execution, then
PR 4, 5, 6, 7 (**PR 3 proposal was dropped** — `/proposal` is 410; its dead chart code is removed in
PR 7). Each remaining PR still gets its own just-in-time `superpowers:writing-plans` plan, executed via
`superpowers:subagent-driven-development`.

Original step (kept for reference): Run `superpowers:writing-plans` for **PR 0 — Foundation** →
`docs/superpowers/plans/2026-06-19-uplot-pr0-foundation.md`, then execute. Only after Foundation lands
and Contracts A/B/C are proven, write PR 1's plan.

---

## Findings from PR 0 execution (carry into later plans)

- **PR 3 (proposal) — DROPPED (no longer migrated).** The proposal surface was removed from the migration: `/proposal` returns HTTP 410 (Politeia proposals are not used in Monetarium — see [wiki/core/pages.md](../../wiki/core/pages.md)), so there is no live page to migrate. Its dead chart code (`proposal_controller.js` + `proposal.tmpl`) is **deleted in PR 7** instead, which also unblocks removing `synchronize`/`multiColumnBarPlotter`/Dygraphs — the proposal controller was their last consumer (auto-bundled via `webpackContext` despite the 410 route). Consequence: the adapter's `syncKey` cursor-sync needs **no** drag-zoom x-range extension for this migration; the multi-chart zoom-parity work that PR 0's findings flagged is now moot.
- **Contract B refinement (already in PR 0).** The tentative `syncCharts(handles, {zoom, cursor})` was replaced by `createChart(el, def, { syncKey })` + `createSyncKey(name)` because uPlot requires the sync key at construction. PR 3+ consume `createSyncKey` + the `syncKey` option.
- **Tooling note.** The real vitest config is `cmd/dcrdata/vitest.config.js` (NOT the `package.json` `vitest` key — vitest 4 ignores it). PR 0 added a `vitest.setup.js` matchMedia polyfill (needed only because the smoke test imports real uPlot). Surface tests (PR 1–6) mock uPlot via `module_helper` and don't import it for real, so they need no setup changes.
