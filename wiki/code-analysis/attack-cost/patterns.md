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
(`explorertypes.go:811,1375`) and never the multi-coin `VARCoinSupply`/`SKACoinSupply`.
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
`defaultDevicePrice=1500`).

**Constraints:**
- Do not re-introduce an auto-fetched exchange rate (no `xcBot.Conversion` here) — the
  page is explicitly a scenario calculator, not a market-data view.
- Do not re-introduce a hard-coded device catalog — users supply the three numbers.
- Source: `attackcost_controller.js` module-level `default*` constants and the
  `updateDeviceHashrate` / `updateDevicePower` / `updateDevicePrice` / `updatePrice`
  action handlers.

## Untyped Go → Stimulus String Contract

**Description:** Two coupled string sets — `data-attackcost-*` attribute keys read via
`this.data.get(...)` and the `static targets` array in `attackcost_controller.js`.
Same pattern as `visualblocks/patterns.md` (untyped Go→JS contract).

**Constraints:**
- Renaming a *data key* → `parseInt(null)=NaN`, silent.
- Renaming/removing a *target* → exception in `connect()`, controller dead (loud).
- Keep template attribute names and the `targets` array in lockstep.

## Vendored-Dygraphs Private Override

**Description:** `attackcost_controller.js` monkey-patches the private
`Dygraph.prototype.doZoomY_` to disable Y-axis zoom. Shares the vendored-Dygraphs coupling
seen in the charts/visualblocks flows.

**Constraints:** any Dygraphs upgrade must re-verify the private method name still exists.

See also:
- /wiki/code-analysis/attack-cost/flow.full.md (shares-pattern-with)
- /wiki/code-analysis/visualblocks/patterns.md (shares-pattern-with: untyped Go→JS contract, vendored Dygraphs)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: legacy flat-field shim — address keeps the back-compat VAR fields, now template-unread)
- /wiki/core/constraints.md (depends-on: C1 numeric precision)
