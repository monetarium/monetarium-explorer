# Attack-Cost Page — Compact Knowledge (LLM-Optimized)

**One-line flow:** node RPC → `blockdata` → `explorer.Store()` → `pageData.HomeInfo`
(in-mem, RWMutex) → `AttackCost` handler (RLock snapshot, **no compute**) →
`attackcost.tmpl` `data-attackcost-*` attributes → `attackcost_controller.js`
(`parseInt`/`parseFloat`) → **all PoW/PoS math in the browser**; live hashrate
pushed via `BLOCK_RECEIVED` WS event.

**Key architectural patterns:**
- **No-compute handler:** `explorerroutes.go` `AttackCost` only copies 5 fields from a
  shared snapshot (height, hashrate, ticket price, ticket pool size/value, coin supply);
  no DB/RPC/XHR. Math lives entirely in JS.
- **VAR-only legacy snapshot:** consumes flat `HomeInfo.CoinSupply int64` /
  `TicketPoolInfo` (`explorertypes.go:911,1480`); never `VARCoinSupply`/`SKACoinSupply`.
  `HomeInfo` also carries `CBlockSubsidy` (`:922`) and `ActiveMiners` (`:939`) but the
  `AttackCost` handler reads neither.
  All labels on the page are `VAR`.
- **Manual-only exchange rate:** USD/VAR comes from the user-edited `Exchange Rate`
  input only — no server-provided seed, no exchange-bot dependency. Default `1`.
  Input has `min="0.01"` but **no `max`**; display refreshed with `digitformat(v, 2, true)`
  (`noComma=true`) so locale commas don't silently break the number-input setter for rates ≥ 1000.
- **Manual-only device specs:** device hashrate, power, and price are user-edited
  inputs (no hard-coded ASIC list, no external catalog). Defaults: 50 Th/s, 1500 W,
  $1500.
- **Untyped Go→JS contract:** `data-attackcost-*` keys + `static targets` array in
  `attackcost_controller.js` are an exact string contract.
- **Live hashrate via BLOCK_RECEIVED:** `connect()` subscribes to the WS event bus;
  `_onBlock` sets `hashrate = blockData.extra.hash_rate` and calls `calculate()` — no
  intermediate `setAllValues` (already done inside `calculate()`).
- **Vendored-Dygraphs coupling:** monkey-patches private `doZoomY_` in
  `attackcost_controller.js`.

**Critical constraints:**
- Precision: `parseInt`/`÷1e8` safe for 8-decimal VAR only; **breaks for 18-decimal SKA**
  (exceeds `float64`). Not portable to SKA without BigInt rewrite.
- **`parseFloat` for hashrate**, not `parseInt` — scientific notation (e.g. `1.6e-07`)
  is truncated to `1` by `parseInt`.
- All hashrate display values use `digitformat(..., 8)` — 8dp matches VAR precision
  and avoids rounding sub-0.0001 values to `"0"`.
- `digitformat(v, n, true)` (`noComma=true`) required for any value written to a
  `<input type="number">` — locale separators silently fail the setter.
- Snapshot is process-global, possibly stale; pre-first-`Store()` → `tpSize=0` →
  `NaN`/`Infinity`.
- `HomeInfo`/`TicketPoolInfo` are JSON-tagged, shared with HTTP API + home page.

**Mutation checklist:**
- Touch `HomeInfo.CoinSupply`/`TicketPoolInfo` types/units → handler template struct +
  JS `parseInt`/÷1e8 sites + API JSON + home page.
- Rename a `data-attackcost-*` **key** → silent `parseInt(null)=NaN` cascade.
- Rename/remove a `data-attackcost-target` → JS throws in `connect()`, controller dead.
- Add SKA → precision-corrupts via `parseInt`/`÷1e8`; needs BigInt path, not this one.
- Upgrade Dygraphs → re-verify `doZoomY_` private override.
- Write locale-formatted number to `input.value` without `noComma=true` → silent stale input.
- Loud failure only on template-exec error (`StatusPage`); JS-side failures are silent.
