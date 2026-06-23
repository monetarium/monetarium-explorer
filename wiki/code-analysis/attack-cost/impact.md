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

**Description:** `explorertypes.go:911,1480` structs are JSON-tagged
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

## Risk: Dygraphs upgrade breaks private override

**Trigger:** Bumping the vendored Dygraphs build.

**Failure mode:** loud (JS exception) or silent (Y-zoom re-enabled).

**Description:** `attackcost_controller.js` overrides private
`Dygraph.prototype.doZoomY_`; a renamed/removed private member silently restores Y-zoom or
throws on assignment.

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
