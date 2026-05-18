# Attack-Cost Page — Compact Knowledge (LLM-Optimized)

**One-line flow:** node RPC → `blockdata` → `explorer.Store()` → `pageData.HomeInfo`
(in-mem, RWMutex) → `AttackCost` handler (RLock snapshot, **no compute**) →
`attackcost.tmpl` `data-attackcost-*` attributes → `attackcost_controller.js`
(`parseInt`/`parseFloat`) → **all PoW/PoS math in the browser**.

**Key architectural patterns:**
- **No-compute handler:** `explorerroutes.go:2693-2742` only copies 6 fields from a
  shared snapshot; no DB/RPC/XHR. Math lives entirely in JS.
- **VAR-only legacy snapshot:** consumes flat `HomeInfo.CoinSupply int64` /
  `TicketPoolInfo` (`explorertypes.go:811,1375`); never `VARCoinSupply`/`SKACoinSupply`.
  Every "DCR" label = legacy VAR naming.
- **Untyped Go→JS contract:** `data-attackcost-*` keys + `static targets` array
  (`attackcost_controller.js:121-185`) are an exact string contract.
- **Vendored-Dygraphs coupling:** monkey-patches private `doZoomY_`
  (`attackcost_controller.js:252`).

**Critical constraints:**
- Precision: `parseInt`/`÷1e8` safe for 8-decimal VAR only; **breaks for 18-decimal SKA**
  (exceeds `float64`). Not portable to SKA without BigInt rewrite.
- Price: `exchanges` `Conversion` returns `nil` only if bot nil; bot-but-no-state →
  `Value:0`, so effective price is **0, not the `24.42` literal** (`bot.go:1056`).
- Snapshot is process-global, possibly stale; pre-first-`Store()` → `tpSize=0` →
  `NaN`/`Infinity`.
- `HomeInfo`/`TicketPoolInfo` are JSON-tagged, shared with HTTP API + home page.

**Mutation checklist:**
- Touch `HomeInfo.CoinSupply`/`TicketPoolInfo` types/units → handler `:2713-2731` + JS
  `:203-209,602` + API JSON + home page.
- Rename a `data-attackcost-*` **key** → silent `parseInt(null)=NaN` cascade.
- Rename/remove a `data-attackcost-target` → JS throws in `connect()`, controller dead.
- Add SKA → precision-corrupts via `parseInt`/`÷1e8`; needs BigInt path, not this one.
- Remove/replace `xcBot` → price defaults; verify it's not silently `0`.
- Upgrade Dygraphs → re-verify `doZoomY_` private override.
- Loud failure only on template-exec error (`StatusPage`); JS-side failures are silent.
