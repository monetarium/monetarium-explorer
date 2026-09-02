# Attack-Cost Page — Mutation Impact

Explicitly identified risks for changing the `/attack-cost` page. Failure mode noted as
**silent** (wrong output, no error) or **loud** (visible error).

## Risk: SKA routed through the VAR-only pipeline

**Trigger:** Attempting to multi-coin-ify the page, or feeding any SKA-scale value into
`data-attackcost-coin-supply` / ticket fields.

**Failure mode:** silent.

**Description:** In `attackcost_controller.js`, `parseInt(this.data.get('coinSupply'))`
in `connect()` and `coinSupply / 100000000` in `showPosCostWarning` assume 8-decimal
VAR fitting `float64`. SKA has 18 decimals, exceeding the `float64` significand —
values are silently truncated/rounded, and the "Attack not possible" gate compares
corrupted magnitudes. Requires a BigInt path, not this one.
(See `wiki/core/constraints.md` C1.)

## Risk: Shared `HomeInfo` / `TicketPoolInfo` type or units change

**Trigger:** Changing `HomeInfo.CoinSupply` (`int64`→string, atoms→coins),
`TicketPoolInfo.Size`/`Value` types, or `HomeInfo.StakeDiff` semantics.

**Failure mode:** silent (math), with cross-page blast radius.

**Description:** `explorertypes.go:855,1414` structs are JSON-tagged
(`json:"coin_supply"`) and consumed by the HTTP API and home page in addition to
the `AttackCost` handler in `explorerroutes.go` and the `parseInt`/`÷1e8` reads in
`attackcost_controller.js`. A units change breaks the JS `/1e8` divisor and
`tpSize`/`tpValue` divisions with no error here and mis-serializes the API elsewhere.

## Risk: Stale / unpopulated snapshot

**Trigger:** Request before the first `explorer.Store()` (startup), or `Store()` failing.

**Failure mode:** silent.

**Description:** Handler reads process-global `pageData` under `RLock`. Zero-valued
`tpSize` makes `val * tpSize`, `getRowForX`, and `varNeed / tpSize` produce
`NaN`/`Infinity`; the page renders alive but with garbage numbers.

## Risk: Untyped Go→JS contract drift

**Trigger:** Renaming a `data-attackcost-*` attribute key or a `data-attackcost-target`.

**Failure mode:** key → silent; target → loud.

**Description:** A renamed *data key* yields `parseInt(null)=NaN` propagating through every
output. A renamed/removed *target* throws in `connect()` (`attackcost_controller.js`),
killing the controller so the page shows static `0`s.

## Risk: uPlot / adapter change breaks the chart's private surface

**Trigger:** Bumping uPlot, or changing `helpers/uplot_adapter` (`loadUPlot`/`buildOpts`).

**Failure mode:** loud (JS exception) or silent (dead click-to-pick, lost zoom range).

**Description:** `attackcost_controller.js` reaches past the adapter into
`this._uplot.over` (click listener host), `.scales.x` (range preserved across `_setDark`
rebuilds), `.cursor.idx`, `.valToPos()`, `.setCursor()`. A renamed member throws; a
changed shape degrades quietly — the chart still draws but click-picking or zoom
persistence stops working. This replaced the old
`Dygraph.prototype.doZoomY_` monkey-patch, which no longer exists.

## Risk: Turbo navigation leaks controller state or a detached chart

**Trigger:** Moving mutable state back to module-level `let`s; adding an `await` in
`connect()`/`_buildChart()` without re-checking `this._destroyed`; attaching a listener to
`_uplot.over` without removing it in `_destroyChart()`.

**Failure mode:** silent.

**Description:** Under `@hotwired/turbo` the JS module graph is evaluated once per session
and survives navigation, while the Stimulus controller is torn down and rebuilt per visit.
Module-level mutable state therefore carries stale values from the previously visited page.
Separately, `_buildChart()` is `async` (`loadUPlot()` is a dynamic import): a fast
navigate-away runs `disconnect()` before the loader resolves, so without the
`this._destroyed` guard the chart is built into a detached element and `_setDark()` can
dereference a null `this._uplot`. Both were live bugs fixed during the migration.

## Resolved: hashrate parseInt scientific-notation truncation (historical)

Prior `connect()` used `parseInt(this.data.get('hashrate'))`. JavaScript's `parseInt`
stops at the first non-digit character, so `parseInt("1.6e-07")` returns `1` instead of
`1.6e-7`. Low-hashrate networks (e.g. testnet) silently showed hashrate as `1 Ph/s` and
rendered all hash-power multiplier targets wrong. Fixed: `parseFloat(...)` is now used
for hashrate.

## Resolved: Exchange-rate locale-comma rejection (historical)

`calculate()` previously wrote `digitformat(varPrice, 2)` to the exchange-rate input.
For rates ≥ 1000 the locale formatter produced `"1,234.00"`, which the browser's
number-input setter silently rejects — the displayed value froze. The HTML `max=10000`
attribute was also masking rates above that ceiling. Both fixed: the `max` attribute is
removed, and the refresh call is now `digitformat(varPrice, 2, true)` (`noComma=true`).

## Resolved: Exchange-bot price silently zero (historical)

Prior version of this handler seeded the USD/VAR rate from `exp.xcBot.Conversion(1.0)`
with a `24.42` literal fallback; when the bot was present without state, every USD
figure rendered `$0`. The current handler no longer touches `xcBot` and exposes no
server-seeded rate — the page sources the rate exclusively from the user-edited
"Exchange Rate" input (default `1`). Do not reintroduce a server-seeded rate.

## Loud-failure summary

The only Go-side loud failure is a template execution error →
`StatusPage(..., ExpStatusError)` in the `AttackCost` handler. Nearly every other
failure on this page is **silent** — the calculator renders but produces wrong numbers.

See also:
- /wiki/code-analysis/attack-cost/flow.full.md (depends-on)
- /wiki/code-analysis/attack-cost/patterns.md (depends-on)
- /wiki/code-analysis/address/impact.md (shares-pattern-with: legacy flat-field shim — same back-compat VAR fields; address's are now template-unread, attack-cost's `HomeInfo` ones still read)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA)
