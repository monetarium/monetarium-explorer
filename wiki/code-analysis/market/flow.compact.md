# `/market` — Compact

**Flow.** `external HTTP/gRPC (Coinbase, Binance, Mexc, dex.decred.org, optional DCRRates gRPC) → exchanges.ExchangeBot goroutine → bot.currentState + stateCopy → 3 outputs: (a) MarketPage handler → market.tmpl initial render; (b) watchExchanges → WebsocketExchangeUpdate → wsHub.xcChan → per-client xc chan → WS event "exchange" → public/index.js bridge → globalEventBus 'EXCHANGE_UPDATE' → market_controller._processXcUpdate; (c) /api/chart/market/{token}/{candlestick|depth} → QuickSticks/QuickDepth → versionedChart cache → market_controller.fetchChart.` Same bot also serves `xcBot.Conversion(float64)` for fiat sidebars on `/`, `/tx`, `/address`, `/treasury` (latter is 410-gated).

**Key architectural patterns.**
- **P1 — Globally-shared optional collector.** One `*exchanges.ExchangeBot` constructed in `main.go`, nullable on every consumer; gate is `if xcBot != nil`. Disabling the page does NOT disable the bot.
- **P2 — Dual collection source for one collector.** gRPC `SubscribeExchanges` from a DCRRates master OR direct per-exchange HTTP poll on `DataExpiry` ticks; both fan into the same `exchangeChan`/`indexChan`.
- **P3 — Lock-free snapshot read.** `updateState()` writes `currentStateBytes` + `stateCopy` under bot write lock; `State()` returns the read-only `stateCopy` under RLock. Template renders never hold the bot mutex.
- **P4 — Versioned lazy-encoded chart cache.** `versionedChart` keyed `(market, token, bin|orderbook)`; `incrementChart` bumps the version on every relevant `updateExchange`; `QuickSticks/QuickDepth` re-encode only on version miss.
- **P5 — Untyped WS bridge via globalEventBus.** Go const `exchangeUpdateID = "exchange"` → `public/index.js` registers `ws.registerEvtHandler('exchange', ...)` and republishes as `globalEventBus.publish('EXCHANGE_UPDATE', JSON.parse(e))`. Four string contracts in two JS files — silent if any drift.

**Critical constraints.**
- **C1.** Entire `exchanges/` is `float64` (price, volume, conversion). VAR-safe; **SKA-incompatible** — no SKA path exists. Reusing `Conversion(float64)` for SKA silently truncates.
- **C7.** `market.tmpl` hard-codes the literal `DCR` (axis labels, "1 DCR =", "Volume (DCR)"); not routed through `coinSymbol`. The label and the data agree only because the data is in fact Decred.
- **C8.** REST `ExchangeBotState` (full snapshot) ≠ WS `WebsocketExchangeUpdate` (per-exchange delta + aggregate). Two independent contracts; market controller reads both.
- **Network-name gate is a no-op on Monetarium mainnet.** `cfg.EnableExchangeBot && activeChain.Name != "mainnet"` blocks only Monetarium testnet/simnet — Monetarium mainnet chaincfg `Name` is also `"mainnet"`. Only `EnableExchangeBot=false` (default) keeps Decred prices off a Monetarium UI.

**Mutation checklist.**
1. Change `WebsocketExchangeUpdate` field? Update `market.tmpl` AND `_processXcUpdate` AND `watchExchanges`.
2. Change `ExchangeBotState` field? Update `market.tmpl` AND `/api/exchanges` consumers; WS path unaffected.
3. Rename `"exchange"` event-id? Update `cmd/dcrdata/internal/explorer/websocket.go:372` AND `cmd/dcrdata/public/index.js:61`. Silent break.
4. Rename `EXCHANGE_UPDATE`? Update `public/index.js:62` AND `market_controller.js:569,581`. Silent break.
5. Add a non-DCR market? Touch `exchanges.go` (CurrencyPair consts, IsValid*, URL maps), `apiroutes.go::retrieveCurrencyPair`, `market.tmpl` (DCR literals), `market_controller.js` (`exchangeLinks`, pair constants). Compile catches Go side; template/JS literals drift silently.
6. Adding SKA-fiat conversion? Build a new big.Int/string API on the bot — do NOT reuse `Conversion(float64)`.
7. Removing the bot? Drop `XcBot` field on `ExplorerConfig` + `appContext`, delete ~7 `xcBot.Conversion(...)` callsites (home, address, tx, treasury × 2), delete `watchExchanges`, drop the bridge in `public/index.js`. Per-route removal is not enough.
8. Toggling `exchange-monitor=1` on a Monetarium mainnet deployment will render real Decred prices. Verify the gate before enabling.
