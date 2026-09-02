# Attack-Cost Page — Full Flow

## Section 1 — Overview

The `/attack-cost` page is a **51%-style majority-attack cost calculator** (PoW + PoS).
It is unusual in this codebase: the Go side does **no computation** — the handler reads a
process-global in-memory snapshot, renders five chain scalars into HTML `data-*` attributes,
and **all attack math runs in the browser** (`attackcost_controller.js`). There is no DB
query, no RPC call, and no XHR for this page. The USD/VAR exchange rate and the mining
device specs (hashrate, power, price) are entered by the user — there is no server-seeded
rate and no hard-coded device list.

Critical framing: the page is **single-coin / VAR-only by construction**. It consumes the
legacy flat `HomeInfo.CoinSupply int64` and never touches `HomeInfo.VARCoinSupply` /
`HomeInfo.SKACoinSupply`. All coin-amount labels on the rendered page are `VAR`.

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
                             all PoW/PoS attack math in the browser (uPlot + 50/50 hybrid formula)
```

## Section 3 — Per-Layer Breakdown

### Layer A — Chain → in-memory snapshot

- **Location:** `blockdata/blockdata.go:208` (`GetCoinSupply` call); `cmd/dcrdata/internal/explorer/explorer.go:498-940` (`(*explorerUI).Store`).
- **Data structures:** `blockData.ExtraInfo.CoinSupply`, `blockData.CurrentStakeDiff`,
  `blockData.PoolInfo` → copied into `explorer/types/explorertypes.go:855-885` `HomeInfo`
  (`CoinSupply int64` `:856`, `StakeDiff float64` `:857`, `HashRate float64`) and `:1414`
  `TicketPoolInfo` (`Size uint32`, `Value float64`), reached through `HomeInfo.PoolInfo`
  (`:873`). Note: `HomeInfo` also carries `CBlockSubsidy BlockSubsidy`
  (`:867`) and `ActiveMiners int64` (`:884`) — neither is read
  by the `AttackCost` handler.
- **Transformations:** `explorer.go:523-525` computes `stakePerc` using VAR `CoinSupply` via
  `dcrutil.Amount(...).ToCoin()` (8-decimal float). `HomeInfo` is written under `p.Lock()`;
  attack-cost reads under `RLock` — a snapshot, not request- or block-scoped.

### Layer B — HTTP handler

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:2635-2679`
  `(*explorerUI).AttackCost`; route registered `cmd/dcrdata/main.go:786`.
- **Data structures:** anonymous struct embedding `*CommonPageData` with
  `HashRate float64`, `Height int64`, `TicketPrice float64`, `TicketPoolSize int64`,
  `TicketPoolValue float64`, `CoinSupply int64`. No `DCRPrice`/USD field — the rate is
  user-entered in the browser.
- **Transformations:**
  - Reads five chain scalars (height, hashrate, ticket price, ticket pool size/value,
    coin supply) from `exp.pageData` under `RLock`; no math, no exchange-bot call.
  - Renders via `execTemplateToString("attackcost", …)`; template error →
    `StatusPage(..., ExpStatusError)`.

### Layer C — Template (Go number → HTML string)

- **Location:** `cmd/dcrdata/views/attackcost.tmpl` (the `data-attackcost-*` attribute
  block at the top of the controller container — that container is now the page's
  `<main>` landmark, not a `<div>`, since the accessible-names pass); template registered
  in the set at `explorer.go:388`.
- **Data structures:** `data-attackcost-height`, `-hashrate`, `-ticket-price`,
  `-ticket-pool-value`, `-ticket-pool-size`, `-coin-supply`. `CoinSupply int64` is emitted
  as a raw VAR-atom integer string. No `-dcrprice` attribute — the rate is user-entered.
- **Transformations:** Go numeric → attribute string. ~90 `data-attackcost-target` hooks
  feed the controller; the attribute key set and the `targets` array are an **untyped
  contract**.

### Layer D — Stimulus controller (string → Number → all math)

- **Location:** `cmd/dcrdata/public/js/controllers/attackcost_controller.js`.
- **Data structures / state:** `this._height, this._varPrice, this._hashrate, this._tpSize,
  this._tpValue, this._tpPrice, this._graphData, this._coinSupply`, plus
  `this._deviceHashrate, this._devicePower, this._devicePrice` and `this.ratioTable`
  (a `Map`). These are **per-instance fields, not module-level `let`s** — the Turbo
  migration made module scope survive navigation, so page state had to move onto the
  controller instance. Neutral defaults `defaultExchangeRate=1`, `defaultDeviceHashrate=50`,
  `defaultDevicePower=1500`, `defaultDevicePrice=1500` remain module constants.
- **Transformations:**
  - `connect()`: `parseInt(this.data.get('height'))`,
    `parseFloat(this.data.get('hashrate'))` (**`parseFloat`, not `parseInt`** — hashrates
    can be in scientific notation on low-hashrate networks, e.g. `1.6e-07`; `parseInt`
    truncates to `1`), `parseFloat(this.data.get('ticketPrice'))`,
    `parseInt(this.data.get('coinSupply'))`. The USD/VAR rate is seeded from
    `defaultExchangeRate` and then overwritten by either the `?price=` URL param or the
    manual input — never from a server attribute. Device specs are seeded from the
    `default*` constants and overwritten by URL params
    `device_hashrate`/`device_power`/`device_price` or the manual inputs.
  - **Live hashrate via `BLOCK_RECEIVED`:** `connect()` subscribes at `:224` to
    `globalEventBus.on('BLOCK_RECEIVED', this._onBlock)`; the closure is built at
    `:220-223`. The handler is minimal:
    `this._hashrate = blockData.extra.hash_rate; this.calculate()`. No intermediate
    `setAllValues` call — `calculate()` at `:570` already writes `actualHashRateTargets`
    with the same value. `disconnect()` (`:227-232`) unsubscribes both this and
    `NIGHT_MODE`, and calls `_destroyChart()`.
  - `rateCalculation(y)`: hybrid PoW/PoS deterrence formula
    `(6x⁵−15x⁴+10x³)/(6y⁵−15y⁴+10y³)`, bit-exact across the Monetarium rework.
  - `calculate()`: device count = `ceil(targetHashRate * 1000 / deviceHashrate)`,
    electricity, PoS `varNeed`, projected ticket price, totals. Hashrate-derived display
    values (`actualHashRate`, `targetHashRate`, `additionalHashRate`, `internalHash`,
    `newHashRate`) all use `digitformat(..., 8)` — 8 decimal places to match VAR
    precision and avoid rounding sub-0.0001 values to `"0"`.  The exchange-rate
    field is refreshed as `digitformat(varPrice, 2, true)` — the third arg `noComma=true`
    suppresses locale thousands-separators; `"1,234.00"` written to a
    `<input type="number">` silently fails (the setter rejects non-numeric strings).
  - **Chart (uPlot, async):** `_buildChart()` (`:234`) awaits `loadUPlot()` from
    `../helpers/uplot_adapter`, then `buildOpts(UPlot, def, …)`, and instantiates
    `this._uplot = new UPlot(opts, [xs, ys], this.graphTarget)`. Because the loader is
    `await`ed, `connect()`/`disconnect()` can interleave under Turbo navigation — a
    `this._destroyed` flag (set in `connect()`, flipped in `disconnect()`) is checked
    after every `await` and bails out. `_destroyChart()` (`:293-299`) removes the stored
    `this._clickCb` click listener from `this._uplot.over` before `destroy()`, then nulls
    both — the listener is registered on the uPlot overlay, which uPlot does not own.
    `_setDark()` (`:302`) rebuilds the whole chart on theme change, preserving the x-scale
    range read off `this._uplot.scales.x` first.
  - `showPosCostWarning()`: `coinSupply / 100000000` — hardcoded 1e8 divisor
    (8-decimal VAR assumption); if `varNeed > totalVarInCirculation` it flags
    "Attack not possible".
  - TurboQuery URL state: `attack_time, target_pow, kwh_rate, other_costs, target_pos,
    price, device_hashrate, device_power, device_price, attack_type`.

## Section 4 — Cross-Layer Dependencies

- **Handler ↔ shared `HomeInfo`:** the handler does not own its data; it reads whatever
  `Store()` last wrote. `HomeInfo`/`TicketPoolInfo` are **shared structs** (JSON-tagged,
  `explorertypes.go:855`) also serialized by the HTTP API and consumed by the home page —
  a field type/units change ripples far beyond this page.
- **Template ↔ controller (brittle):** the `data-attackcost-*` attribute keys
  (`this.data.get(...)`) and the `static targets` array form an exact, untyped string
  contract. A renamed *data key* yields `parseInt(null) = NaN` silently; a
  renamed/removed *target* throws in `connect()` and kills the controller.
- **No exchange-bot coupling:** the handler does not call `exp.xcBot`; USD/VAR comes
  from the manual input only. Past versions of this handler did seed the rate from
  `xcBot.Conversion` — do not reintroduce that coupling.
- **uPlot (via the shared adapter):** the chart is built through
  `../helpers/uplot_adapter` (`loadUPlot` / `buildOpts`), the same seam every migrated
  chart uses — an adapter change is cross-page. The previous coupling here was a
  monkey-patch of the private `Dygraph.prototype.doZoomY_`; that is **gone**, since uPlot
  has no implicit y-zoom to suppress. What remains fragile is uPlot's own surface:
  `this._uplot.over` (the overlay DOM node the click listener attaches to),
  `.scales.x`, `.cursor.idx`, `.valToPos()` and `.setCursor()` are all touched directly.
- **Async chart build ↔ Turbo lifecycle:** `_buildChart` is `async`, so a fast
  navigate-away can run `disconnect()` before the loader resolves. The `this._destroyed`
  guard is the only thing preventing a chart from being built into a detached element
  (and `_setDark` from dereferencing a null `this._uplot`).

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
- **No server-seeded exchange rate / device list:** USD/VAR and device specs are
  scenario parameters the user enters. Monetarium has no listed market price; the
  handler must not call `xcBot` or seed any rate from the server.

## Section 6 — Mutation Impact

When modifying this page, check:

- **Direct dependencies:** the `AttackCost` template-struct fields in
  `explorerroutes.go`; the top-of-container `data-attackcost-*` block in
  `attackcost.tmpl`; the `parseInt`/`parseFloat` reads in `attackcost_controller.js`
  `connect()`.
- **Indirect dependencies:** `HomeInfo`/`TicketPoolInfo` shared with HTTP API + home
  page; `explorer.go:498-940` `Store()` population.
- **Serialization boundary:** Go numeric → `data-*` string → JS `parseInt/parseFloat`
  (and the JSON-tagged shared struct used elsewhere).
- **Rendering layers:** uPlot via `helpers/uplot_adapter` (`loadUPlot`/`buildOpts`),
  ~90 `data-attackcost-target` hooks.

**Silent failures (no error, wrong output):**
- `pageData` not yet populated (startup) → `tpSize = 0` → `NaN`/`Infinity` outputs.
- Routing SKA atoms through this path → `parseInt` precision loss, wrong `/1e8` divisor.
- Mistyped/renamed `data-*` key → `NaN` propagation through every output.
- Controller state moved back to module scope → values leak across Turbo navigations
  (the module is evaluated once per session, not once per page).
- `_buildChart` resolving after `disconnect()` without the `this._destroyed` check →
  a uPlot instance built into a detached node; invisible, but it holds the click
  listener and the element alive.

**Hard failures (visible):**
- Template execution error → `StatusPage(..., ExpStatusError)` in the `AttackCost`
  handler.
- Renamed/removed Stimulus *target* → JS exception in `connect()`, controller dead, page
  shows static `0`s.

## Section 7 — Common Pitfalls

1. Assuming `coin_supply` here means total network value — it is **VAR only**; SKA is
   silently excluded.
2. Multi-coin-ifying the page by piping SKA atoms through the existing
   `data-*`/`parseInt`/`/1e8` path — violates the 18-decimal `big.Int` rule, corrupts
   values with no error.
3. Re-introducing a server-seeded exchange rate (e.g. via `xcBot.Conversion`) — the
   page is a scenario calculator; Monetarium has no listed market price. Don't do it.
4. Re-introducing a hard-coded device catalog — the user types the three numbers
   (hashrate / power / price); past Decred-era model presets were removed by design.
5. Assuming the handler fetches fresh chain data — it reads a possibly-stale shared
   snapshot under `RLock`.
6. Refactoring `HomeInfo`/`TicketPoolInfo` field types "just for this page" — the structs
   feed the API JSON and the home page.
7. Renaming template attributes for cleanliness — the `data.get()` keys and `targets`
   array are an exact, untyped contract; mismatches fail silently or kill the controller.
8. Upgrading uPlot (or changing `helpers/uplot_adapter`) without re-checking the
   private-ish surface this controller reaches into: `_uplot.over`, `.scales.x`,
   `.cursor.idx`, `.valToPos`, `.setCursor`.
9. Calling `digitformat(v, n)` (without `noComma=true`) for a value that is written back
   into a `<input type="number">` — locale-formatting (e.g. `"1,234.00"`) causes the
   browser's setter to silently reject the value, leaving the input stale. Use
   `digitformat(v, n, true)` for any `input.value =` assignment.
10. Moving controller state back to module-level `let`s. Under Turbo the module is
   evaluated once and survives navigation, so module globals leak between page visits;
   all mutable page state must live on the controller instance (`this._*`).
11. Adding an `await` in `connect()`/`_buildChart` without re-checking `this._destroyed`
   afterwards, or attaching a listener to `_uplot.over` without removing it in
   `_destroyChart()` — both leak across Turbo navigations.

## Section 8 — Evidence

- `cmd/dcrdata/main.go:786` — route registration.
- `cmd/dcrdata/internal/explorer/explorerroutes.go` `AttackCost` — handler; reads under
  `RLock`, renders, no math.
- `cmd/dcrdata/internal/explorer/explorer.go:523-525, 498-940` — `Store()` → `HomeInfo`.
- `explorer/types/explorertypes.go:855-885` (`HomeInfo`), `:1414-1421` (`TicketPoolInfo`).
- `blockdata/blockdata.go:208` — `GetCoinSupply` RPC call (the deprecated
  `BlockSKAPoWRewards*` / `ExtractSKARewardsFromCoinbase` helpers were deleted from this
  file; they were never on the attack-cost path).
- `cmd/dcrdata/views/attackcost.tmpl` — `data-*` contract at the top of the controller
  container; manual `Exchange Rate` input (`step="0.01"`, `min="0.01"`, **no `max`**),
  `Device Hashrate`, `Device Power`, `Device Price` inputs in the "Adjustable Parameters" /
  "PoW Attack" blocks.
- `cmd/dcrdata/public/js/controllers/attackcost_controller.js` — module globals
  (`varPrice`, `deviceHashrate`, `devicePower`, `devicePrice`, `coinSupply`, …),
  neutral `default*` constants, `rateCalculation` (formula), `static targets` (Stimulus
  contract), `connect()` (data parse + URL state + `BLOCK_RECEIVED` subscription),
  `_onBlock` handler (`:220-224`: live hashrate update + `calculate()`),
  `_buildChart`/`_destroyChart`/`_setDark` (`:234`, `:293`, `:302` — uPlot lifecycle,
  `_destroyed` guard, click-listener removal), `calculate()` (`:528`; PoW + PoS totals,
  hashrate at 8dp `:570`, exchange-rate noComma), `showPosCostWarning()` (supply gate).

See also:
- /wiki/code-analysis/attack-cost/patterns.md (shares-pattern-with: VAR-only legacy snapshot, untyped `data-*`↔Stimulus contract, client-side-only math, manual-only scenario inputs)
- /wiki/code-analysis/attack-cost/impact.md (depends-on: shared `HomeInfo` struct, snapshot staleness)
- /wiki/code-analysis/address/impact.md (shares-pattern-with: legacy flat-field shim — attack-cost still reads its `HomeInfo` flat fields; address keeps the analogous back-compat VAR fields, now template-unread)
- /wiki/code-analysis/visualblocks/patterns.md (shares-pattern-with: untyped Go→JS contract)
- /wiki/code-analysis/charts/patterns.md (shares-pattern-with: uPlot via helpers/uplot_adapter)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA)
- /wiki/core/pages.md (depends-on: `/attack-cost` route registry entry)
