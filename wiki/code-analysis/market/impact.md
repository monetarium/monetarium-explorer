# Market — Mutation Impact

Blast radius for changes to the `/market` page, the `exchanges` collector, and the WS
exchange-update pipeline. Use this checklist when:

- Removing `/market` (the documented near-term direction per
  [/wiki/core/pages.md](../../core/pages.md)).
- Adding a Monetarium-native market (VAR-USDT, SKA1-USDT, …) to replace the Decred markets.
- Touching `xcBot.Conversion(...)` callsites or the `WebsocketExchangeUpdate` shape.
- Renaming the WS event-id or the `EXCHANGE_UPDATE` bus event.

Severity scale: **Critical** (data corruption / crash) · **High** (silent UX drift,
hard-to-notice in QA) · **Medium** (loud break caught by smoke test) · **Low**
(cosmetic / dev-time only).

---

## R1 — `float64` monoculture inside `exchanges/` (C1 silent violation surface)

**Trigger.** Adding any SKA market to the `exchanges` package, or routing SKA values
through `xcBot.Conversion(...)`.

**Affected flow.** Backend collector (`exchanges/bot.go`, `exchanges/exchanges.go`) →
every consumer.

**Failure mode.** **Silent.** SKA has 18 decimals (>15-digit float64 significand);
truncation happens inside `BaseState.Price float64`, `xcBot.Conversion(float64)`, the
multi-source average in `processState`, and `JSON.parse(...).price` on the JS side
(`Number` is also IEEE 754 double).

**Description.** The entire `exchanges/` package — including all subscriber channels, the
WS `WebsocketExchangeUpdate.Price/Volume/Indices`, the REST `BaseState` / `ExchangeBotState`
/ `ExchangeRates`, and the `Conversion` struct — is `float64`. There is no `*big.Int` or
atom-string code path. Adding a SKA market by reusing this surface silently truncates
≥3 decimal digits per value; the page will render plausible numbers that don't match the
underlying exchange feed.

**Fix shape.** A SKA fiat conversion needs a new API: a `*big.Int`- or string-typed
`ConversionAtoms(coinType uint8, atoms string) *Conversion`-equivalent, possibly with a
separate `BaseState`-like struct that carries the price as a string. Don't squeeze SKA
through the existing float64 plumbing.

**See.** [/wiki/core/constraints.md](../../core/constraints.md) C1.

---

## R2 — DCR-symbol hard-coding (5-layer fan-out)

**Trigger.** Adding or renaming a market in `exchanges.go`. Re-labelling any "DCR"
string in the template or JS controller to "VAR" / "SKA{n}".

**Affected layers.**

| Layer | File | Symbol form |
|---|---|---|
| URL strings | [exchanges/exchanges.go:121–166](../../../exchanges/exchanges.go) | `?symbol=DCRUSDT` query params |
| CurrencyPair consts | [exchanges/exchanges.go:66–73](../../../exchanges/exchanges.go) | `CurrencyPairDCRBTC`, `CurrencyPairDCRUSDT` |
| Validators | [exchanges/exchanges.go:75–81](../../../exchanges/exchanges.go) | `IsValidDCRPair`, `IsValidIndex` |
| REST handler | [apiroutes.go:2280–2291](../../../cmd/dcrdata/internal/api/apiroutes.go) | `retrieveCurrencyPair` |
| HTML labels | [market.tmpl](../../../cmd/dcrdata/views/market.tmpl) lines 22, 39, 91 | `"1 DCR ="`, `"DCR Vol."`, `Bitcoin Indices` heading |
| JS controller | [market_controller.js:1002–1003, 1110–1113](../../../cmd/dcrdata/public/js/controllers/market_controller.js) | `exchangeLinks.CurrencyPairDCRUSDT/BTC`, axis labels |

**Failure mode.** Go side: **Loud** — renaming `CurrencyPairDCRBTC` breaks compile across
the package. Template/JS literals: **Silent** — page renders "DCR" labels next to
non-Decred prices, or "VAR" labels next to actually-Decred prices, depending on which
direction the edit went.

**Description.** None of the DCR literals are routed through `coinSymbol` /
`renderCoinType` (C7). The label and the data are coupled only by convention — the
labels are accurate today only because the data really is Decred.

**Fix shape.** Treat the whole stack as one atomic change. If adding a Monetarium market,
introduce a new `CurrencyPair` constant + URLs block + validator branch + handler accept
case + template/JS variant in one commit.

---

## R3 — Network-name gate is a no-op on Monetarium mainnet

**Trigger.** Setting `exchange-monitor=1` on a Monetarium mainnet deployment.

**Affected flow.** Bot construction → all downstream consumers.

**Failure mode.** **High — silent content drift.** The Monetarium UI will render real
Decred exchange data (Coinbase, Binance, Mexc, dex.decred.org) as if it were the local
asset's market.

**Description.** [main.go:414](../../../cmd/dcrdata/main.go) guards exchange-monitor with:

```go
if cfg.EnableExchangeBot && activeChain.Name != "mainnet" {
    log.Warnf("disabling exchange monitoring. only available on mainnet")
    cfg.EnableExchangeBot = false
}
```

In `dcrdata`, this kept ExchangeBot off Decred testnet. In Monetarium, the mainnet
chaincfg's `Name` field is also literally `"mainnet"`
(`monetarium-node/chaincfg@v1.1.0/mainnetparams.go:84`) — so the guard fires only on
Monetarium testnet/simnet. The only practical brake on Monetarium mainnet is that
`EnableExchangeBot` defaults to `false` and is commented out in
[sample-dcrdata.conf:89](../../../cmd/dcrdata/sample-dcrdata.conf).

**Fix shape.** When (not if) `/market` is disabled per the
[pages.md](../../core/pages.md) plan, also rip out the `ExchangeBot` construction in
`main.go` so a stray `exchange-monitor=1` cannot surface Decred markets. If keeping the
construction code, change the gate to something Monetarium-meaningful (an explicit
network ID + asset whitelist).

---

## R4 — Cross-page fan-out: disabling the page does not disable the bot

**Trigger.** Removing the `/market` route without auditing the rest of the codebase.

**Affected handlers.**

- Home (`explorerroutes.go:199–207` — `homeConversions{ExchangeRate, StakeDiff, CoinSupply, PowSplit}`)
- Address (`explorerroutes.go:768–769` — `pageData.FiatConversion`, gated to addresses with `BlockTime` within 1h)
- Tx (`explorerroutes.go:1357–1359` — `pageData.Conversions.{Total, Fees}`)
- Treasury (`explorerroutes.go:1501–1517` — `ConvertedBalance`, `FiatBalance`; route returns 410 but the handler code is still reachable through struct dispatch)
- MarketPage (`explorerroutes.go:2520`)
- REST: `/api/exchanges`, `/api/exchangerate`, `/api/exchanges/codes`,
  `/api/chart/market/{token}/{candlestick|depth}`
  ([apiroutes.go:1987–2030, 2138–2203](../../../cmd/dcrdata/internal/api/apiroutes.go))
- `watchExchanges` goroutine fired unconditionally in `explorer.New()`
  ([explorer.go:426](../../../cmd/dcrdata/internal/explorer/explorer.go)) — early-returns
  if `xcBot == nil`.
- WS `/ws` event bridge in
  [public/index.js:60–63](../../../cmd/dcrdata/public/index.js).

**Failure mode.** **Medium.** A partial removal leaves the bot polling exchange APIs
(network egress, log spam) with no UI surface. No crash. If only the route is removed and
the page is requested, chi returns 404 — but the bot still polls.

**Description.** The bot is constructed in `main.go` independent of any route registration.
Per-route gating is independent of bot lifecycle. Complete removal requires editing
~7 handler files, the WS bridge, the explorer goroutine, and the `XcBot` fields in
`ExplorerConfig` / `appContext`.

**Fix shape.** When removing `/market`:

1. Drop the `MarketPage` handler + route + `views/market.tmpl` +
   `public/js/controllers/market_controller.js`.
2. Drop the WS bridge in `public/index.js`.
3. Drop `watchExchanges` + `WebsocketExchangeUpdate` + `WebsocketMiniExchange` +
   `exchangeUpdateID` + `xcChan` from `websocket.go` / `websockethandlers.go`.
4. Drop `xcBot.Conversion(...)` callsites in home / address / tx / treasury (and the
   `Conversions` / `homeConversions` types if they become empty).
5. Drop the four REST endpoints + `retrieveCurrencyPair` + middleware
   (`ExchangeTokenContext`, `StickWidthContext`).
6. Drop `XcBot` from `ExplorerConfig` + `appContext` and the `*exchanges.ExchangeBot`
   import.
7. Drop the bot construction block in `main.go`.
8. Drop the `exchanges/` and `exchanges/rateserver/` modules (separate `go.mod` —
   confirm no other module imports them with `grep -rn "monetarium-explorer/exchanges" .`).

---

## R5 — WS event-id + bus event string drift (silent break)

**Trigger.** Renaming `exchangeUpdateID` ("exchange") or `'EXCHANGE_UPDATE'`.

**Affected sites.**

- `cmd/dcrdata/internal/explorer/websocket.go:372` (`const exchangeUpdateID = "exchange"`)
- `cmd/dcrdata/internal/explorer/websockethandlers.go:309` (used)
- `cmd/dcrdata/public/index.js:61` (`ws.registerEvtHandler('exchange', ...)`)
- `cmd/dcrdata/public/index.js:62` (`globalEventBus.publish('EXCHANGE_UPDATE', ...)`)
- `cmd/dcrdata/public/js/controllers/market_controller.js:569, 581`

**Failure mode.** **High — silent.** WS messages flow but the handler never fires; the
market page renders the initial template snapshot then stops updating. No JS error.

**Description.** Four string literals, two files on the JS side, two on the Go side.
No compile-time link.

**Fix shape.** Co-edit all four sites in the same commit. Consider extracting a shared
constant on the JS side at minimum.

---

## R6 — `WebsocketExchangeUpdate` vs `ExchangeBotState` schema asymmetry (C8)

**Trigger.** Adding a field on either schema and reading it from the other side.

**Affected files.**

- WS schema: `cmd/dcrdata/internal/explorer/websocket.go:376–395`.
- REST schema: `exchanges/bot.go:100–109` (`ExchangeBotState`).
- WS emit: `explorer.go:990–1017` (`watchExchanges.sendXcUpdate`).
- WS consume: `market_controller.js:1092–1140` (`_processXcUpdate`).
- REST/template consume: `market.tmpl` (initial render).

**Failure mode.** **High — silent.** Initial render shows the new field, live updates
don't (or vice versa).

**Description.** C8 manifestation: same logical concept (exchange state), two on-the-wire
shapes. The market controller reads from both, never reconciling that fields on the WS
delta are a strict subset of the REST snapshot.

**Fix shape.** Treat the two schemas as independent contracts. Any added field needs
co-edits in: Go REST struct, Go WS struct, `sendXcUpdate` builder, JS template reader, JS
WS handler. Reference `core/constraints.md` C8 for the general rule.

---

## R7 — DCRRates remote master keeps polling even when page is dead

**Trigger.** Leaving `ratemaster=<host>` configured after `/market` removal.

**Affected sites.**

- `bot.connectMasterBot` ([bot.go:564–591](../../../exchanges/bot.go)) — gRPC dial,
  goroutine reading the stream forever, reconnect loop with backoff.
- `exchanges/ratesproto` (generated protobuf), `exchanges/rateserver` (the master
  server — separate Go module).

**Failure mode.** **Low — resource leak.** A goroutine, an open TLS connection, plus
periodic reconnect attempts on disconnect.

**Description.** Even with no UI surface, if the bot is constructed and `MasterBot` is
set, the stream is opened and drained. Indirectly, this also keeps the `dcrrates`
generated code in the dependency graph.

**Fix shape.** Covered by R4 (drop bot construction). If keeping the bot for cross-page
conversions but removing rateserver support, also drop `MasterBot`/`MasterCertFile` from
the config struct and the `connectMasterBot` path.

---

## R8 — Module-level JS state survives within an SPA session

**Trigger.** Mounting two `data-controller="market"` blocks on the same page, or
introducing a controller that imports `market_controller.js` indirectly.

**Affected sites.**

- `market_controller.js`: module-level `settings`, `responseCache`, `requestCounter`,
  `Dygraph`, `indices`, `fiatCode`, `availableCandlesticks`, `availableDepths`,
  `conversionFactor`, `chartStroke`, `focused`, `refreshAvailable`, `stickZoom` (lines
  62–98 of the file).

**Failure mode.** **Low — cross-controller cross-talk.** Two market controllers on one
page would share request cache and settings.

**Description.** Stimulus controllers are normally instance-scoped, but the file declares
many `let`/`const` at module top-level — those persist across `connect()`/`disconnect()`
within the same SPA session. `disconnect()` partially resets `responseCache = {}`
([market_controller.js:577](../../../cmd/dcrdata/public/js/controllers/market_controller.js))
but not the rest.

**Fix shape.** Not a current bug — there is exactly one `/market` page in the app and one
controller mount. Document the constraint so future refactors don't multi-mount the
controller.

---

## R9 — Aggregated price hides per-exchange divergence (default 60m staleness window)

**Trigger.** One subscribed exchange returns a stale or wildly-off price within
`RequestExpiry` (default 60m).

**Affected sites.**

- `bot.dcrPriceAndVolume` ([bot.go:927–947](../../../exchanges/bot.go)) — average across
  exchanges that pass `processState`.
- `bot.processState` ([bot.go:824–857](../../../exchanges/bot.go)) — volume-weighted
  per-pair sum.
- `RequestExpiry` default `60m`
  ([bot.go:30](../../../exchanges/bot.go), [main.go:418–423](../../../cmd/dcrdata/main.go)).

**Failure mode.** **Medium — visible drift.** The big "1 DCR =" headline price is the
aggregate; individual exchange rows still show their per-exchange figures, so the
discrepancy is observable but not flagged.

**Description.** `dcrPriceAndVolume` averages across DcrExchanges; one stuck exchange
warps the aggregate until its `LastUpdate` falls outside `RequestExpiry`. Tunable via
`DataExpiry` / `RequestExpiry`, both defaults pinned high.

**Fix shape.** Not a defect — accepting noise is the design. Worth knowing when
investigating "why does the home page price not match Binance".

---

## R10 — `IsFailed()` is partial, and `Conversion()` still returns stale on failure

**Trigger.** All BTC indices OR all DCR exchanges go stale for longer than `RequestExpiry`.

**Affected sites.**

- `bot.updateState` ([bot.go:950–960](../../../exchanges/bot.go)) sets
  `bot.failed = true` when `btcPrice == 0 || dcrPrice == 0` — leaves `stateCopy` pointing
  at the last good values.
- `bot.IsFailed()` ([bot.go:983–987](../../../exchanges/bot.go)).
- `getExchangeState` ([explorer.go:1047–1052](../../../cmd/dcrdata/internal/explorer/explorer.go))
  returns `nil` when `IsFailed()` — `/market` shows "monitoring disabled".
- `xcBot.Conversion` ([bot.go:1045–1058](../../../exchanges/bot.go)) does **not** check
  `IsFailed()` — keeps returning `Value: xcState.Price * dcrVal` from the stale snapshot.

**Failure mode.** **Medium — silent.** `/market` correctly degrades to the "disabled"
text. Home / tx / address pages keep showing stale fiat conversions.

**Description.** The "fail-safe" wiring is implemented in `MarketPage` only.
Cross-page conversion callsites never call `IsFailed`. As long as the bot has ever held a
valid price, the home page will keep showing the last cached fiat value indefinitely.

**Fix shape.** Either (a) make `xcBot.Conversion(...)` return `nil` when `IsFailed()`, or
(b) add explicit `IsFailed()` checks at each consumer. Both are behavior changes; pick
one and apply uniformly. Document on the `Conversion` struct.

---

See also:
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1, C7, C8)
- [/wiki/code-analysis/market/flow.full.md](flow.full.md) (depends-on: trace this risk list against)
- [/wiki/code-analysis/market/patterns.md](patterns.md) (depends-on: P1 — globally-shared optional collector)
- [/wiki/code-analysis/page-rendering/impact.md](../page-rendering/impact.md) (shares-pattern-with: cross-page shared state risks — `xcBot` is the share here)
- [/wiki/core/pages.md](../../core/pages.md) (depends-on: `/market` listed under "Should be disabled" — R3, R4 inform the disable plan)
