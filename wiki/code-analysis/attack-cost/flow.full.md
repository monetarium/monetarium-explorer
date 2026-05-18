# Attack-Cost Page — Full Flow

## Section 1 — Overview

The `/attack-cost` page is a **51%-style majority-attack cost calculator** (PoW + PoS).
It is unusual in this codebase: the Go side does **no computation** — the handler reads a
process-global in-memory snapshot, renders six numbers into HTML `data-*` attributes, and
**all attack math runs in the browser** (`attackcost_controller.js`). There is no DB query,
no RPC call, and no XHR for this page.

Critical framing: the page is **single-coin / VAR-only by construction**. It consumes the
legacy flat `HomeInfo.CoinSupply int64` and never touches `HomeInfo.VARCoinSupply` /
`HomeInfo.SKACoinSupply`. Every "DCR" label in the template is legacy naming for VAR.

## Section 2 — End-to-End Data Flow

```
monetarium-node RPC ──► blockdata collector ──► explorer.Store() ──► pageData.HomeInfo (in-mem, RWMutex)
  GetCoinSupply           blockData.ExtraInfo.CoinSupply        (written under p.Lock())
  GetStakeDifficulty      blockData.CurrentStakeDiff
  ticket pool             blockData.PoolInfo
                                                                         │
                                         AttackCost handler (RLock snapshot, no compute)
                                                                         │
                             attackcost.tmpl  data-attackcost-* attributes (Go number → string)
                                                                         │
                             attackcost_controller.connect(): parseInt / parseFloat
                                                                         │
                             all PoW/PoS attack math in the browser (Dygraphs + Decred formula)
```

## Section 3 — Per-Layer Breakdown

### Layer A — Chain → in-memory snapshot

- **Location:** `blockdata/blockdata.go:207` (`GetCoinSupply`); `cmd/dcrdata/internal/explorer/explorer.go:574-649` (`(*explorerUI).Store`).
- **Data structures:** `blockData.ExtraInfo.CoinSupply`, `blockData.CurrentStakeDiff`,
  `blockData.PoolInfo` → copied into `explorer/types/explorertypes.go:811` `HomeInfo`
  (`CoinSupply int64`, `StakeDiff float64`, `HashRate float64`) and `:1375` `TicketPoolInfo`
  (`Size uint32`, `Value float64`).
- **Transformations:** `explorer.go:562-564` computes `stakePerc` using VAR `CoinSupply` via
  `dcrutil.Amount(...).ToCoin()` (8-decimal float). `HomeInfo` is written under `p.Lock()`;
  attack-cost reads under `RLock` — a snapshot, not request- or block-scoped.

### Layer B — HTTP handler

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:2693-2742`
  (`(*explorerUI).AttackCost`); route registered `cmd/dcrdata/main.go:817`.
- **Data structures:** anonymous struct embedding `*CommonPageData` with
  `HashRate float64`, `Height int64`, `DCRPrice float64`, `TicketPrice float64`,
  `TicketPoolSize int64`, `TicketPoolValue float64`, `CoinSupply int64`.
- **Transformations:**
  - `price := 24.42`; overwritten whenever `exp.xcBot != nil` via
    `exp.xcBot.Conversion(1.0)` (`exchanges/bot.go:1045`). `Conversion` returns `nil`
    **only** when `bot == nil`; with the bot present but no exchange state yet it returns
    `Value: 0` (`bot.go:1056-1057`) — so the effective price becomes **0, not 24.42**.
  - Reads six fields from `exp.pageData` under `RLock`, no math performed.
  - Renders via `execTemplateToString("attackcost", …)`; template error →
    `StatusPage(..., ExpStatusError)`.

### Layer C — Template (Go number → HTML string)

- **Location:** `cmd/dcrdata/views/attackcost.tmpl:7-17` (the `data-attackcost-*` attribute
  block); template registered in the set at `explorer.go:424`.
- **Data structures:** `data-attackcost-height`, `-hashrate`, `-dcrprice`, `-ticket-price`,
  `-ticket-pool-value`, `-ticket-pool-size`, `-coin-supply`. `CoinSupply int64` is emitted
  as a raw VAR-atom integer string.
- **Transformations:** Go numeric → attribute string. ~90 `data-attackcost-target` hooks
  feed the controller; the attribute key set and the `targets` array are an **untyped
  contract**.

### Layer D — Stimulus controller (string → Number → all math)

- **Location:** `cmd/dcrdata/public/js/controllers/attackcost_controller.js`.
- **Data structures / globals:** `height, dcrPrice, hashrate, tpSize, tpValue, tpPrice,
  graphData, currentPoint, coinSupply` (module-level, line 47); `deviceList` (lines 63-80,
  hardcoded `DCR5`/`D1` ASIC specs + a `medium.com/decred` citation).
- **Transformations:**
  - `connect()` lines 203-209: `parseInt(this.data.get('height'))`,
    `parseFloat(this.data.get('ticketPrice'))`, `parseInt(this.data.get('coinSupply'))`, …
  - `rateCalculation(y)` lines 49-61: Decred hybrid PoW/PoS deterrence formula
    `(6x⁵−15x⁴+10x³)/(6y⁵−15y⁴+10y³)`.
  - `calculate()` lines 503-579: device count, electricity, PoS DCR-need, projected ticket
    price, totals.
  - `showPosCostWarning()` lines 601-611: `coinSupply / 100000000` — hardcoded 1e8 divisor
    (8-decimal assumption); if `DCRNeed > totalDCRInCirculation` it flags
    "Attack not possible".
  - TurboQuery URL state: `attack_time, target_pow, kwh_rate, other_costs, target_pos,
    price, device, attack_type` (lines 189-198, 324-331).

## Section 4 — Cross-Layer Dependencies

- **Handler ↔ shared `HomeInfo`:** the handler does not own its data; it reads whatever
  `Store()` last wrote. `HomeInfo`/`TicketPoolInfo` are **shared structs** (JSON-tagged,
  `explorertypes.go:812`) also serialized by the HTTP API and consumed by the home page —
  a field type/units change ripples far beyond this page.
- **Template ↔ controller (brittle):** the `data-attackcost-*` attribute keys
  (`this.data.get(...)`) and the `static targets` array (lines 121-185) form an exact,
  untyped string contract. A renamed *data key* yields `parseInt(null) = NaN` silently; a
  renamed/removed *target* throws in `connect()` and kills the controller.
- **Price ↔ exchange bot:** `DCRPrice` depends on `exchanges` bot state at request time;
  no state → `$0` everywhere, no error.
- **Dygraphs:** `attackcost_controller.js:252` monkey-patches the private
  `Dygraph.prototype.doZoomY_` — version-fragile coupling to the vendored Dygraphs build.

## Section 5 — Critical Constraints

- **VAR-only / single-coin:** consumes legacy flat `HomeInfo.CoinSupply`; ignores
  `VARCoinSupply`/`SKACoinSupply` entirely. SKA coins are absent from the attack model;
  "Total attack cost" reflects VAR only. (See `wiki/core/constraints.md` C1.)
- **Precision (hard rule):** `parseInt(coinSupply)` + `coinSupply / 100000000` are safe
  *only* because VAR has 8 decimals and fits `float64`. SKA has 18 decimals and exceeds the
  `float64` significand — this pipeline silently corrupts any SKA-scale value. The whole
  client-side `Number` math model is not portable to SKA without a BigInt rewrite.
- **Snapshot semantics:** process-global `pageData` guarded by an RWMutex; before the first
  `Store()` all fields are zero (`tpSize = 0` → divisions produce `NaN`/`Infinity`).
- **Misleading price fallback:** the literal `24.42` is *not* the no-exchange value; with
  the bot present and no state the effective price is `0`.

## Section 6 — Mutation Impact

When modifying this page, check:

- **Direct dependencies:** `explorerroutes.go:2713-2731` struct fields;
  `attackcost.tmpl:7-17` attribute keys; `attackcost_controller.js:203-209` parse calls.
- **Indirect dependencies:** `HomeInfo`/`TicketPoolInfo` shared with HTTP API + home page;
  `explorer.go:574-649` `Store()` population; `exchanges` bot `Conversion`.
- **Serialization boundary:** Go numeric → `data-*` string → JS `parseInt/parseFloat`
  (and the JSON-tagged shared struct used elsewhere).
- **Rendering layers:** Dygraphs (`doZoomY_` patch), ~90 `data-attackcost-target` hooks.

**Silent failures (no error, wrong output):**
- Bot present, no exchange state → `price = 0` → all USD figures `$0`.
- `pageData` not yet populated (startup) → `tpSize = 0` → `NaN`/`Infinity` outputs.
- Routing SKA atoms through this path → `parseInt` precision loss, wrong `/1e8` divisor.
- Mistyped/renamed `data-*` key → `NaN` propagation through every output.

**Hard failures (visible):**
- Template execution error → `StatusPage(..., ExpStatusError)`
  (`explorerroutes.go:2733-2736`).
- Renamed/removed Stimulus *target* → JS exception in `connect()`, controller dead, page
  shows static `0`s.

## Section 7 — Common Pitfalls

1. Assuming "DCR"/`coin_supply` here means total network value — it is **VAR only**; SKA is
   silently excluded.
2. Multi-coin-ifying the page by piping SKA atoms through the existing
   `data-*`/`parseInt`/`/1e8` path — violates the 18-decimal `big.Int` rule, corrupts
   values with no error.
3. Treating `24.42` as the no-exchange fallback — the real no-data price is `0`.
4. Assuming the handler fetches fresh chain data — it reads a possibly-stale shared
   snapshot under `RLock`.
5. Refactoring `HomeInfo`/`TicketPoolInfo` field types "just for this page" — the structs
   feed the API JSON and the home page.
6. Renaming template attributes for cleanliness — the `data.get()` keys and `targets`
   array are an exact, untyped contract; mismatches fail silently or kill the controller.
7. Upgrading Dygraphs without re-checking the private `doZoomY_` override.

## Section 8 — Evidence

- `cmd/dcrdata/main.go:817` — route registration.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:2693-2742` — `AttackCost` handler;
  `:2696-2700` price logic; `:2733-2736` template-error path.
- `cmd/dcrdata/internal/explorer/explorer.go:562-564, 574-649` — `Store()` → `HomeInfo`.
- `explorer/types/explorertypes.go:811-837` (`HomeInfo`), `:1375-1382` (`TicketPoolInfo`).
- `blockdata/blockdata.go:207` — `GetCoinSupply`.
- `exchanges/bot.go:1045-1058` — `Conversion` (nil only when bot nil; `Value:0` when no state).
- `cmd/dcrdata/views/attackcost.tmpl:7-17` — `data-*` contract; `:2731`-equivalent int64 emit.
- `cmd/dcrdata/public/js/controllers/attackcost_controller.js:47` (globals),
  `:49-61` (formula), `:63-80` (devices), `:121-185` (targets), `:203-209` (data parse),
  `:252` (Dygraph hack), `:503-579` (calculate), `:601-611` (supply gate).

See also:
- /wiki/code-analysis/attack-cost/patterns.md (shares-pattern-with: VAR-only legacy snapshot, untyped `data-*`↔Stimulus contract, client-side-only math)
- /wiki/code-analysis/attack-cost/impact.md (depends-on: shared `HomeInfo` struct, exchange-bot price, snapshot staleness)
- /wiki/code-analysis/address/summary.impact.md (shares-pattern-with: legacy flat fields read while everything is labelled `DCR`)
- /wiki/code-analysis/visualblocks/patterns.md (shares-pattern-with: untyped Go→JS contract, vendored Dygraphs coupling)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA)
- /wiki/core/pages.md (depends-on: `/attack-cost` route registry entry)
