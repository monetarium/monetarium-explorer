# Attack-Cost Page — Mutation Impact

Explicitly identified risks for changing the `/attack-cost` page. Failure mode noted as
**silent** (wrong output, no error) or **loud** (visible error).

## Risk: SKA routed through the VAR-only pipeline

**Trigger:** Attempting to multi-coin-ify the page, or feeding any SKA-scale value into
`data-attackcost-coin-supply` / ticket fields.

**Failure mode:** silent.

**Description:** `attackcost_controller.js:209` `parseInt(coinSupply)` and `:602`
`coinSupply / 100000000` assume 8-decimal VAR fitting `float64`. SKA has 18 decimals,
exceeding the `float64` significand — values are silently truncated/rounded, and the
"Attack not possible" gate (`:601-611`) compares corrupted magnitudes. Requires a BigInt
path, not this one. (See `wiki/core/constraints.md` C1.)

## Risk: Shared `HomeInfo` / `TicketPoolInfo` type or units change

**Trigger:** Changing `HomeInfo.CoinSupply` (`int64`→string, atoms→coins),
`TicketPoolInfo.Size`/`Value` types, or `HomeInfo.StakeDiff` semantics.

**Failure mode:** silent (math), with cross-page blast radius.

**Description:** `explorertypes.go:811,1375` structs are JSON-tagged
(`json:"coin_supply"`) and consumed by the HTTP API and home page in addition to
`explorerroutes.go:2713-2731` and `attackcost_controller.js:203-209,602`. A units change
breaks the JS `/1e8` divisor and `tpSize`/`tpValue` divisions with no error here and
mis-serializes the API elsewhere.

## Risk: Exchange-bot price is silently zero

**Trigger:** Exchange bot present but no state yet (startup, upstream outage), or removing
`xcBot`.

**Failure mode:** silent.

**Description:** `exchanges/bot.go:1045-1058` `Conversion` returns `nil` **only** when
`bot == nil`; with the bot present and no state it returns `Value: 0`. The handler guard
`if rate := exp.xcBot.Conversion(1.0); rate != nil` (`explorerroutes.go:2696-2700`) then
sets `price = 0`, **not** the `24.42` literal — every USD figure renders `$0`.

## Risk: Stale / unpopulated snapshot

**Trigger:** Request before the first `explorer.Store()` (startup), or `Store()` failing.

**Failure mode:** silent.

**Description:** Handler reads process-global `pageData` under `RLock`
(`explorerroutes.go:2702-2711`). Zero-valued `tpSize` makes `val * tpSize`,
`getRowForX`, and `DCRNeed / tpSize` produce `NaN`/`Infinity`; the page renders alive but
with garbage numbers.

## Risk: Untyped Go→JS contract drift

**Trigger:** Renaming a `data-attackcost-*` attribute key or a `data-attackcost-target`.

**Failure mode:** key → silent; target → loud.

**Description:** A renamed *data key* yields `parseInt(null)=NaN` propagating through every
output. A renamed/removed *target* throws in `connect()` (`attackcost_controller.js`),
killing the controller so the page shows static `0`s.

## Risk: Dygraphs upgrade breaks private override

**Trigger:** Bumping the vendored Dygraphs build.

**Failure mode:** loud (JS exception) or silent (Y-zoom re-enabled).

**Description:** `attackcost_controller.js:252` overrides private
`Dygraph.prototype.doZoomY_`; a renamed/removed private member silently restores Y-zoom or
throws on assignment.

## Loud-failure summary

The only Go-side loud failure is a template execution error →
`StatusPage(..., ExpStatusError)` (`explorerroutes.go:2733-2736`). Nearly every other
failure on this page is **silent** — the calculator renders but produces wrong numbers.

See also:
- /wiki/code-analysis/attack-cost/flow.full.md (depends-on)
- /wiki/code-analysis/attack-cost/patterns.md (depends-on)
- /wiki/code-analysis/address/impact.md (shares-pattern-with: legacy flat-field shim / `DCR` labelling — same back-compat VAR fields; address's are now template-unread, attack-cost's `HomeInfo` ones still read)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA)
