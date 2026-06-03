# Attack-Cost Page — Compact Knowledge (LLM-Optimized)

**One-line flow:** node RPC → `blockdata` → `explorer.Store()` → `pageData.HomeInfo`
(in-mem, RWMutex) → `AttackCost` handler (RLock snapshot, **no compute**) →
`attackcost.tmpl` `data-attackcost-*` attributes → `attackcost_controller.js`
(`parseInt`/`parseFloat`) → **all PoW/PoS math in the browser**.

**Key architectural patterns:**
- **No-compute handler:** `explorerroutes.go` `AttackCost` only copies 5 fields from a
  shared snapshot (height, hashrate, ticket price, ticket pool size/value, coin supply);
  no DB/RPC/XHR. Math lives entirely in JS.
- **VAR-only legacy snapshot:** consumes flat `HomeInfo.CoinSupply int64` /
  `TicketPoolInfo` (`explorertypes.go:877,1444`); never `VARCoinSupply`/`SKACoinSupply`.
  All labels on the page are `VAR`.
- **Manual-only exchange rate:** USD/VAR comes from the user-edited `Exchange Rate`
  input only — no server-provided seed, no exchange-bot dependency. Default `1`.
- **Manual-only device specs:** device hashrate, power, and price are user-edited
  inputs (no hard-coded ASIC list, no external catalog). Defaults: 50 Th/s, 1500 W,
  $1500.
- **Untyped Go→JS contract:** `data-attackcost-*` keys + `static targets` array in
  `attackcost_controller.js` are an exact string contract.
- **Vendored-Dygraphs coupling:** monkey-patches private `doZoomY_` in
  `attackcost_controller.js`.

**Critical constraints:**
- Precision: `parseInt`/`÷1e8` safe for 8-decimal VAR only; **breaks for 18-decimal SKA**
  (exceeds `float64`). Not portable to SKA without BigInt rewrite.
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
- Loud failure only on template-exec error (`StatusPage`); JS-side failures are silent.
