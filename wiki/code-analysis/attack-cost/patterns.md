# Attack-Cost Page — Patterns

Domain-local patterns observed in this flow. These recur elsewhere in the wiki; global
normalization is left to a future `Consolidate:` pass.

## No-Compute Handler / Client-Side Math

**Description:** The Go handler performs **zero domain computation** — it copies a fixed
set of scalars (height, hashrate, ticket price, ticket pool size/value, coin supply)
from a shared snapshot into template `data-*` attributes; every attack calculation
(PoW device cost, electricity, PoS VAR-need, hybrid 50/50 deterrence formula,
projected ticket price) runs in `attackcost_controller.js`.

**Constraints:**
- All numeric correctness lives in JS `Number`; the Go side cannot enforce precision.
- Any value that must stay exact (SKA atoms) cannot pass through this pattern unchanged.
- Source: `explorerroutes.go` `AttackCost`; `attackcost_controller.js` `rateCalculation`,
  `calculate`, `showPosCostWarning`.

## VAR-Only Legacy Snapshot

**Description:** Reads the legacy flat `HomeInfo.CoinSupply int64` / `TicketPoolInfo`
(`explorertypes.go:856,1414`) and never the multi-coin `VARCoinSupply`/`SKACoinSupply`.
`HomeInfo` also carries `CBlockSubsidy` (`:867`) and `ActiveMiners` (`:884`) but neither
is read by the `AttackCost` handler.
All coin-amount labels on the page are `VAR`. Shared with `address/patterns.md`
("Legacy flat-field shim (residual)") — the address page retains the same
back-compat legacy flat VAR fields, though its template no longer reads them
(attack-cost still does, for `HomeInfo`).

**Constraints:**
- Treat "coin supply" on this page as VAR-only; SKA is out of scope by design.
- `HomeInfo`/`TicketPoolInfo` are JSON-tagged and shared with the HTTP API + home page —
  field changes are cross-page.

## Manual-Only Scenario Inputs (No Server-Sourced Defaults)

**Description:** Two classes of input are user-edited and **not** seeded from the
server: the USD/VAR `Exchange Rate` (Monetarium has no listing, so no authoritative
rate) and the mining-device specs (hashrate, power, price — no hard-coded ASIC list,
no external catalog). Defaults are neutral round numbers in the controller
(`defaultExchangeRate=1`, `defaultDeviceHashrate=50`, `defaultDevicePower=1500`,
`defaultDevicePrice=1500`). The exchange-rate input has no upper ceiling (`max`
attribute removed) so arbitrarily large USD/VAR rates are accepted.

**Constraints:**
- Do not re-introduce an auto-fetched exchange rate (no `xcBot.Conversion` here) — the
  page is explicitly a scenario calculator, not a market-data view.
- Do not re-introduce a hard-coded device catalog — users supply the three numbers.
- When writing a computed value back to a `<input type="number">` (e.g. refreshing the
  exchange-rate field in `calculate()`), call `digitformat(v, n, true)` with
  `noComma=true`. Locale-formatted strings like `"1,234.00"` are silently rejected by
  the browser's number-input setter, leaving the displayed value stale.
- Source: `attackcost_controller.js` module-level `default*` constants and the
  `updateDeviceHashrate` / `updateDevicePower` / `updateDevicePrice` / `updatePrice`
  action handlers; exchange-rate `<input>` in `attackcost.tmpl` (Adjustable Parameters).

## Untyped Go → Stimulus String Contract

**Description:** Two coupled string sets — `data-attackcost-*` attribute keys read via
`this.data.get(...)` and the `static targets` array in `attackcost_controller.js`.
Same pattern as `visualblocks/patterns.md` (untyped Go→JS contract).

**Constraints:**
- Renaming a *data key* → `parseInt(null)=NaN`, silent.
- Renaming/removing a *target* → exception in `connect()`, controller dead (loud).
- Keep template attribute names and the `targets` array in lockstep.

## uPlot Through the Shared Adapter

**Description:** The chart is created with `loadUPlot()` / `buildOpts()` from
`cmd/dcrdata/public/js/helpers/uplot_adapter.js` — the same seam every migrated chart in
the codebase uses. The controller then reaches past the adapter into uPlot's own surface:
`this._uplot.over` (overlay node, for the click listener), `.scales.x` (range preserved
across theme rebuilds), `.cursor.idx`, `.valToPos()`, `.setCursor()`.

**Supersedes:** the previous `Dygraph.prototype.doZoomY_` monkey-patch, removed with the
Dygraph→uPlot migration. uPlot has no implicit y-zoom, so nothing replaced it.

**Constraints:**
- A `uplot_adapter` change is cross-page, not local to attack-cost.
- A uPlot upgrade must re-verify `over`, `scales`, `cursor`, `valToPos`, `setCursor`.
- Theme changes rebuild the chart wholesale (`_setDark` → `_buildChart`); the x-range must
  be read off the old instance first or the user's zoom is lost.

## Instance-Scoped Controller State (Turbo)

**Description:** All mutable page state is held on the controller instance
(`this._height`, `this._hashrate`, `this._coinSupply`, `this._uplot`, `this.ratioTable`, …),
never in module-level `let`s. Under `@hotwired/turbo` the JS module graph is evaluated once
per session and survives navigation, so module-level mutable state leaks from one page
visit to the next; the Stimulus controller instance is the only per-visit scope.

**Constraints:**
- Module scope is for constants only (`defaultExchangeRate`, `defaultDevice*`, helper fns).
- Any `async` work started in `connect()` must re-check `this._destroyed` after each
  `await` — `disconnect()` can run first under Turbo navigation.
- Any listener attached to a node the framework does not own (here `_uplot.over`) must be
  stored and removed in `disconnect()`/`_destroyChart()`.

See also:
- /wiki/code-analysis/attack-cost/flow.full.md (shares-pattern-with)
- /wiki/code-analysis/visualblocks/patterns.md (shares-pattern-with: untyped Go→JS contract)
- /wiki/code-analysis/charts/patterns.md (shares-pattern-with: uPlot via helpers/uplot_adapter)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: legacy flat-field shim — address keeps the back-compat VAR fields, now template-unread)
- /wiki/core/constraints.md (depends-on: C1 numeric precision)
