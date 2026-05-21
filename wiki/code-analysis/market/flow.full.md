# `/market` — Full Flow Trace

> Trace anchor: `HEAD` of `feature/dcrdata-nav-remove-dead-links` at write time.
> Domain scope: the `/market` HTML page and the shared `exchanges` collector that also
> feeds fiat conversions for `/`, `/tx/{txid}`, `/address/{address}`, and the (410-gated)
> `/treasury` handler. Per [/wiki/core/pages.md](../../core/pages.md), this page is flagged
> "should be disabled" — none of the listed exchanges trade Monetarium tokens. Document its
> current real wiring so the future removal/replacement work has an accurate map.

---

## Section 1 — Overview

`MarketPage` is a server-rendered HTML shell + Stimulus controller. It is the only page in
the repo whose data flow originates from **external HTTP/gRPC sources** (Coinbase, Binance,
Mexc, dex.decred.org, optional DCRRates master) — not from `monetarium-node` RPC or the
PostgreSQL backend. A single `*exchanges.ExchangeBot` runs as a background goroutine; its
in-memory snapshot is read three ways:

- **HTML render** (initial paint of `/market`) — `MarketPage` handler reads `xcBot.State()`
  and dumps it into [market.tmpl](../../../cmd/dcrdata/views/market.tmpl).
- **WebSocket push** (live updates on `/market`) — `watchExchanges` reads
  `xcBot.UpdateChannels()` and emits `WebsocketExchangeUpdate` to every connected client.
- **Versioned REST chart cache** (depth/candlestick chart loads) —
  `/api/chart/market/{token}/{candlestick|depth}` calls `xcBot.QuickSticks` /
  `xcBot.QuickDepth`, which lazy-encode and cache JSON bytes.

The same bot is also queried by other handlers via `xcBot.Conversion(float64) *Conversion`
for fiat sidebars on home/tx/address pages. **All seven callsites use the same nullable
`xcBot` pointer; the entire surface is float64-only (VAR-safe, SKA-incompatible) and
DCR-symbol-hard-coded.**

---

## Section 2 — End-to-End Data Flow

```
[external feeds]                        ┌───────────── REST: GET /api/exchanges
   │                                    │              GET /api/exchangerate
   ├── gRPC SubscribeExchanges (DCRRates ├───── HTML: GET /market
   │   master, if `ratemaster` set)     │              ↓
   │                                    │       MarketPage handler ── exp.getExchangeState()
   └── HTTP poll: Coinbase, Binance,    │              ↓                      ↓
       Mexc, dex.decred.org             │       xcBot.State() (read-only snapshot)
   ↓                                    │              ↓
exchanges.ExchangeBot (one goroutine)   │       market.tmpl render
   ├── exchangeChan / indexChan         │
   │     ↓                              ├───── REST charts:
   │   updateExchange / updateIndices   │       GET /api/chart/market/{token}/candlestick/{bin}
   │     ↓                              │       GET /api/chart/market/{token}/depth
   │   currentState (mutex-protected)   │              ↓
   │     ├── currentStateBytes (JSON)   │       xcBot.QuickSticks / QuickDepth
   │     └── stateCopy (read-only ptr)  │              ↓
   │                                    │       versionedChart cache (per-key bytes)
   └── signalExchangeUpdate / Index ─→ updateChans / indexChans (per subscriber)
                                            ↓
                            (explorer subscriber)
                            explorer.watchExchanges()  [explorer.go:984]
                                            ↓
                            WebsocketExchangeUpdate (per-update, not full state)
                                            ↓
                            wsHub.xcChan  →  hub.run() fan-out  →  per-client xc chan
                                            ↓
                            RootWebsocket: WebSocketMessage{EventId:"exchange",
                                                            Message: JSON(update)}
                                            ↓
[browser]
   public/index.js:61    ws.registerEvtHandler('exchange', e ⇒
                            globalEventBus.publish('EXCHANGE_UPDATE', JSON.parse(e)))
                                            ↓
   market_controller.js:568  globalEventBus.on('EXCHANGE_UPDATE', this.processXcUpdate)
                                            ↓
                            DOM mutation: price/volume/arrow/aggregate, BTC indices,
                                          refreshChart() if depth/candlestick visible
```

The depth/candlestick chart is **not** served by the WS push. The WS update triggers an
in-controller `clearCache(this.lastUrl) + refreshChart()` if a chart is currently visible,
which issues a fresh `GET /api/chart/market/...` call.

---

## Section 3 — Per-Layer Breakdown

### 3.1 Backend collector — `exchanges/` (separate Go module)

**Location.** [exchanges/bot.go](../../../exchanges/bot.go),
[exchanges/exchanges.go](../../../exchanges/exchanges.go). Module
[exchanges/go.mod](../../../exchanges/go.mod).

**Construction.** [main.go:413–440](../../../cmd/dcrdata/main.go) (`_main`):

```go
var xcBot *exchanges.ExchangeBot
if cfg.EnableExchangeBot && activeChain.Name != "mainnet" {
    log.Warnf("disabling exchange monitoring. only available on mainnet")
    cfg.EnableExchangeBot = false
}
if cfg.EnableExchangeBot {
    botCfg := exchanges.ExchangeBotConfig{
        Index:          cfg.ExchangeCurrency,    // default "USD"
        MasterBot:      cfg.RateMaster,
        MasterCertFile: cfg.RateCertificate,
    }
    if cfg.DisabledExchanges != "" {
        botCfg.Disabled = strings.Split(cfg.DisabledExchanges, ",")
    }
    xcBot, err = exchanges.NewExchangeBot(&botCfg)
    if err != nil { /* log + continue, xcBot stays nil */ } else {
        wg.Add(1); go xcBot.Start(ctx, &wg)
    }
}
```

`xcBot` is then passed as `ExplorerConfig.XcBot` and `appContext.XcBot`. It is **nullable
on every consumer**.

**Configured exchanges.** `exchanges/exchanges.go:169–183`:

- Indices (BTC/USDT-fiat sources): `Coinbase` (`NewCoinbase`).
- DCR-{Asset} markets: `Binance`, `DexDotDecred` (host
  `dex.decred.org:7232`), `Mexc`. All Decred. No Monetarium asset.

**Polling URLs** (all hard-coded `DCR`-symbol strings — `exchanges/exchanges.go:121–166`):
e.g. `https://api.binance.com/api/v3/ticker/24hr?symbol=DCRUSDT`.

**Start loop.** `exchanges/bot.go:434–561`. Two modes:

1. **DCRRates master mode** — if `MasterBot != ""`, opens a gRPC `SubscribeExchanges` stream
   and drains updates as `exchangeStateFromProto`. The local poll timer is drained and
   never fires (`bot.masterConnection != nil ⇒ skip nextTick`).
2. **Direct poll mode** — fan out: `for _, xc := range bot.Exchanges { go xc.Refresh() }`,
   then schedule the next tick via `nextTick()` (per `DataExpiry`, default 5m, min 5s).
   Each exchange writes to `bot.exchangeChan` / `bot.indexChan`; the `Start` loop dispatches
   `updateExchange` / `updateIndices` and re-broadcasts via `signalExchangeUpdate` /
   `signalIndexUpdate` to all subscriber channels registered through `UpdateChannels()`.

**State recomputation.** `bot.go:949–976` (`updateState`):

- `dcrPriceAndVolume(code)` averages per-DCR-exchange processed price/volume.
- `processState` (`bot.go:824–857`) converts each `(pair, price)` into the index currency
  via `indexPrice(BTC|USDT-Index, code)`, applies volume weighting, rejects exchanges older
  than `RequestExpiry` (default 60m).
- Snapshot copy: `bot.stateCopy = bot.currentState.copy()` — `copy()` deep-copies the two
  `map[string]map[CurrencyPair]*ExchangeState` maps (`bot.go:112–122, 125–129`), so readers
  hold a stable pointer that the writer never mutates.
- JSON-marshals into `bot.currentStateBytes` for `StateBytes()`.

**State exposure.**

- `bot.State() *ExchangeBotState` — returns `bot.stateCopy` under RLock (`bot.go:646–650`).
- `bot.IsFailed() bool` — true when there are no fresh BTC or DCR sources
  (`bot.go:983–987`); set inside `updateState`. **The "failed" path returns the cached
  stale `stateCopy` from `State()` but causes `getExchangeState` to return `nil`.**
- `bot.Conversion(dcrVal float64) *Conversion` — used by other handlers (home, address,
  tx). Returns `&Conversion{Value: xcState.Price * dcrVal, Index: xcState.Index}` if state
  exists, else `&Conversion{Value:0, Index:"USD"}` (`bot.go:1045–1058`). **Never returns
  nil if `bot != nil`** — so `if xcBot != nil` is the only practical gate.

### 3.2 HTML render path — `MarketPage`

**Handler.** `cmd/dcrdata/internal/explorer/explorerroutes.go:2513–2531`:

```go
func (exp *explorerUI) MarketPage(w http.ResponseWriter, r *http.Request) {
    str, err := exp.templates.exec("market", struct {
        *CommonPageData
        XcState *exchanges.ExchangeBotState
    }{
        CommonPageData: exp.commonData(r),
        XcState:        exp.getExchangeState(),
    })
    ...
}
```

`exp.getExchangeState()` (`explorer.go:1047–1052`) returns `nil` when `xcBot == nil` **or**
`xcBot.IsFailed()`. The template treats `nil` as the "monitoring disabled" branch.

**Route.** [cmd/dcrdata/main.go:786](../../../cmd/dcrdata/main.go):
`r.Get("/market", explore.MarketPage)`. Not wrapped in `withCache` — every hit re-executes
the template (no ETag for `/market`).

**Template.** [cmd/dcrdata/views/market.tmpl](../../../cmd/dcrdata/views/market.tmpl):

- Lines 10–11: `{{- if $botState -}}` — single top-level gate. `nil` ⇒ renders
  `<h5>Exchange monitoring disabled</h5>` only.
- Lines 20–29: hard-coded `1 DCR =` literal + `{{printf "%.2f" $botState.Price}}`.
- Lines 32–86: `Monetarium Markets` table built from `$botState.VolumeOrderedExchanges`
  (`bot.go:215–238`, sorts `tokenedExchange` by descending volume). Calls
  `xcDisplayName` (`templates.go:861–867`, special-cases `dcrdex → dex.decred.org`, else
  `titler.String(token)`), `threeSigFigs`, `$botState.PriceToFiat`, `$botState.FiatToBtc`.
- Lines 89–103: `Bitcoin Indices` block from `$botState.BitcoinIndices()` (`bot.go:166–175`,
  maps token → `BTCIndex` state).
- Lines 107–229: Stimulus chart shell — wires `data-market-target=...` for chart, bin,
  zoom, exchange, conversion buttons.
- Lines 178–186: `data-indices="{{$botState.Indices}}"` is a JSON blob (string),
  `data-code="{{$botState.Index}}"` is the default currency code — both consumed by the
  Stimulus controller in `connect()` (`market_controller.js:522–523`).

The page does **not** use template cloning (C6 N/A — no `<template id="...">` here).

### 3.3 WebSocket push path — `watchExchanges`

**Subscriber goroutine.** Started unconditionally in `explorer.New()` (`explorer.go:426`):
`go exp.watchExchanges()`. Early-returns if `exp.xcBot == nil`
(`explorer.go:985`).

**Channel registration.** `xcChans := exp.xcBot.UpdateChannels()` (`bot.go:604–618`) —
each call allocates **new buffered (cap 16) channels** and appends them to the bot's
`updateChans`/`indexChans` slices. So if `watchExchanges` were ever restarted, channels
would leak; in practice it runs once for the process lifetime.

**Per-update payload assembly** (`explorer.go:990–1017`):

```go
sendXcUpdate := func(isFiat bool, token, pair string, updater *exchanges.ExchangeState) {
    xcState := exp.xcBot.State()
    update := &WebsocketExchangeUpdate{
        Updater: WebsocketMiniExchange{Token, CurrencyPair: pair,
                                       Price, Volume, Change},
        IsFiatIndex: isFiat,
        Index:       exp.xcBot.Index,
        Price:       xcState.Price,
        Volume:      xcState.Volume,
        Indices:     map[string]float64{
            "BTC-Index":  xcState.BtcPrice,
            "USDT-Index": indexPrice(USDTIndex, xcState.FiatIndices),
        },
    }
    select {
    case exp.wsHub.xcChan <- update:
    default:
        log.Warnf("Failed to send WebsocketExchangeUpdate on WebsocketHub channel")
    }
}
```

`Price`/`Volume` in the envelope are the **aggregated, multi-exchange-averaged** values
(snapshot at the moment of the push). The `Updater` block is the **single exchange that
triggered the update**.

**Hub fan-out.** `websocket.go:320–323`:

```go
case update := <-wsh.xcChan:
    for _, client := range wsh.clients {
        client.xc <- update
    }
```

Drops happen at the **bot → hub** boundary (`select default` with `wsHub.xcChan` cap 16,
`websocket.go:101`), not at the **hub → client** boundary (blocking send per client).

**Per-client encode + send.** `websockethandlers.go:306–322`:

```go
case update := <-xcChan:
    buff := new(bytes.Buffer)
    enc := json.NewEncoder(buff)
    webData := WebSocketMessage{EventId: exchangeUpdateID /* "exchange" */, Message: "error"}
    err := enc.Encode(update)
    if err == nil { webData.Message = buff.String() }
    err = send(webData)
```

`exchangeUpdateID = "exchange"` is the event-string contract (`websocket.go:372`).

### 3.4 JS bridge + Stimulus controller

**WS handler bridge.** [public/index.js:60–63](../../../cmd/dcrdata/public/index.js):

```js
ws.registerEvtHandler('exchange', (e) => {
    globalEventBus.publish('EXCHANGE_UPDATE', JSON.parse(e))
})
```

Registered exactly once per page load. **Not** controller-scoped — it lives at the SPA
entry point. The only subscriber to `EXCHANGE_UPDATE` is the market controller
(`market_controller.js:569`).

**Initial fetch.** Stimulus `connect()` (`market_controller.js:509–574`):

- Parses `data-indices` JSON → module-level `indices`.
- Parses `data-code` → module-level `fiatCode`.
- Restores `chart/xc/bin/pair` from URL via TurboQuery; defaults
  `xc="binance"`, `pair=CurrencyPairDCRUSDT`, `bin="1h"`, `chart="depth"`.
- Subscribes `EXCHANGE_UPDATE` → `_processXcUpdate`.
- Lazy-imports Dygraphs (`/* webpackChunkName: "dygraphs" */`) then issues the first
  `fetchChart()`.

**Chart fetch.** `fetchChart()` (`market_controller.js:652–716`):

- Builds `/api/chart/market/{xc}/candlestick/{bin}?currencyPair=${pair}` or
  `/api/chart/market/{xc}/depth?currencyPair=${pair}`.
- Module-level `responseCache` is keyed by full URL — first request populates,
  subsequent identical requests skip the network. `requestCounter` deduplicates
  in-flight calls (a later request abandons earlier callbacks).

**WS update handler.** `_processXcUpdate(update)` (`market_controller.js:1092–1140`):

- Updates module-level `indices` from `update.indices`.
- Fiat branch (`update.fiat`): updates the per-token BTC index span (only `BTCIndex` —
  `USDTIndex` updates are received but ignored visually).
- DCR-asset branch: writes price/volume/arrow/fiat into the matching `xcRow` row, plus
  updates the aggregate row and the big `data-market-target="price"` value.
- If depth chart visible: clear cache for `lastUrl` and `refreshChart()`. If candlestick
  visible: refresh only when cache already expired.

### 3.5 REST chart cache

**Route.** [apirouter.go:232–243](../../../cmd/dcrdata/internal/api/apirouter.go):

```go
mux.Route("/chart", func(r chi.Router) {
    r.Route("/market/{token}", func(rd chi.Router) {
        rd.Use(m.ExchangeTokenContext)
        rd.With(m.StickWidthContext).Get("/candlestick/{bin}", app.getCandlestickChart)
        rd.Get("/depth", app.getDepthChart)
    })
    ...
})
```

**Handlers.** [apiroutes.go:1987–2030](../../../cmd/dcrdata/internal/api/apiroutes.go).
Both: gate on `c.xcBot == nil ⇒ 503`, extract token + currency pair via
`retrieveCurrencyPair` (`apiroutes.go:2280–2291` — defaults to `DCR-BTC`, rejects anything
that is not `DCR-BTC`/`DCR-USDT`), call `c.xcBot.QuickSticks` / `QuickDepth`
(`bot.go:1077–1178`):

- Cache lookup keyed `genCacheID(market, token, bin|orderbook)`.
- On miss: take bot write lock, encode `candlestickResponse{Index, Price, Sticks,
  Expiration}` or `depthResponse{BtcIndex, Price, Data, Expiration}`, store as a
  `versionedChart{chartID, dataID, chart bytes}` keyed by the same chartID.
- `dataID` is bumped by `incrementChart` inside `updateExchange` whenever new sticks or
  depth arrive (`bot.go:880–887`); fetch races see a version mismatch and re-encode.

**Other REST endpoints** that hit the same bot (not on `/market` UI but worth knowing):

- `GET /api/exchanges` (`apiroutes.go:2138`) — returns `xcBot.State()` (or
  `ConvertedState(code)` if `?code=` supplied).
- `GET /api/exchangerate` (`apiroutes.go:2164`) — returns trimmed `ExchangeRates` view
  (`bot.go:702–722`).
- `GET /api/exchanges/codes` (`apiroutes.go:2191`) — returns `AvailableIndices()`.

### 3.6 Cross-page consumers of the same bot

`xcBot.Conversion(float64) *Conversion` is also called by:

- Home page (`explorerroutes.go:199–207`) — `ExchangeRate`, `StakeDiff`, `CoinSupply`,
  `PowSplit` as fiat sidebar.
- Address page (`explorerroutes.go:768–769`) — `pageData.FiatConversion =
  xcBot.Conversion(data.TotalSent)`, gated to addresses with last block time < 1h.
- Tx page (`explorerroutes.go:1357–1359`) — `pageData.Conversions.{Total, Fees}`.
- Treasury (`explorerroutes.go:1501–1517`) — `ConvertedBalance`, `FiatBalance`. The
  `/treasury` route currently returns HTTP 410 (`main.go:804–809`), but **the handler code
  still exists and is reachable through the explorerUI's struct**.

All consumers pass **VAR coin values** (via `dcrutil.Amount(...).ToCoin() float64`); none
of them pass SKA atoms (which would silently truncate — see §5).

---

## Section 4 — Cross-Layer Dependencies

### 4.1 The bot is one nullable pointer shared across many layers

`*exchanges.ExchangeBot` is constructed in `main.go` and passed by pointer into:

- `ExplorerConfig.XcBot` → `explorerUI.xcBot` (`explorer.go:235, 324`).
- `appContext.XcBot` (REST API) — see `cmd/dcrdata/main.go:482, 640`.

Every consumer guards with `if xcBot != nil`. Disabling the bot is therefore not a route
issue — the goroutines just never start and every guard fails. Removing the bot field is a
**fan-out edit** across handler files.

### 4.2 WS schema (`WebsocketExchangeUpdate`) ≠ REST schema (`ExchangeBotState`)

The WS update is a **per-exchange delta** with an embedded aggregate snippet:

```go
type WebsocketExchangeUpdate struct {
    Updater     WebsocketMiniExchange `json:"updater"`
    IsFiatIndex bool                  `json:"fiat"`
    Index       string                `json:"index"`
    Price       float64               `json:"price"`   // aggregated
    Volume      float64               `json:"volume"`  // aggregated
    Indices     map[string]float64    `json:"indices"` // {BTC-Index, USDT-Index}
}
type WebsocketMiniExchange struct {
    Token, CurrencyPair string
    Price, Volume, Change float64
}
```

The REST `ExchangeBotState` is the **full snapshot** with nested per-exchange/per-pair
states + candlesticks + depth. **Renaming or restructuring `ExchangeBotState` does not
auto-propagate to the WS shape, and vice versa.** This is a C8-class asymmetry (see
[/wiki/core/constraints.md](../../core/constraints.md)).

The market controller, on initial render, reads from `ExchangeBotState`-derived template
fields. On live update, it reads from `WebsocketExchangeUpdate` fields. The two paths share
no parsing code — any field added on one side must be replicated on the other (and in the
template + JS reader).

### 4.3 JS event-string + globalEventBus indirection

The chain is:

```
Go const exchangeUpdateID = "exchange"
   → JS ws.registerEvtHandler('exchange', ...)        [public/index.js]
       → globalEventBus.publish('EXCHANGE_UPDATE', ...) [public/index.js]
           → globalEventBus.on('EXCHANGE_UPDATE', ...)  [market_controller.js]
```

Four string contracts in two files. Renaming the Go constant breaks `index.js` silently
(no error — handler just never fires); renaming the bus event breaks
`market_controller.js` silently.

### 4.4 Network-name gate is shared with the chain

`if cfg.EnableExchangeBot && activeChain.Name != "mainnet"` in `main.go:414` reads the
**chain config's `Name` string**. Monetarium's mainnet params file
(`monetarium-node/chaincfg@v1.1.0/mainnetparams.go:84`) sets `Name: "mainnet"` — the
same string as Decred. The check therefore does **not** veto exchange-monitor on a
Monetarium mainnet deployment. The only practical brake is that `EnableExchangeBot`
defaults to `false` and is commented out in
[sample-dcrdata.conf:89](../../../cmd/dcrdata/sample-dcrdata.conf).

### 4.5 Hard-coded "DCR" everywhere

DCR symbol literals exist in five disconnected layers:

| Layer | File | Form |
|---|---|---|
| Exchange URLs | `exchanges/exchanges.go:121–166` | `?symbol=DCRUSDT` query strings |
| Currency-pair consts | `exchanges/exchanges.go:66–73` | `CurrencyPairDCRBTC`, `CurrencyPairDCRUSDT` |
| Pair validator | `exchanges/exchanges.go:75–77` | `IsValidDCRPair` (closed set) |
| Pair default + accept-list | `apiroutes.go:2280–2291` | `retrieveCurrencyPair` → `pair.IsValidDCRPair()` |
| HTML/JS UI | `market.tmpl`, `market_controller.js` | `1 DCR =`, `Volume (DCR)`, `exchangeLinks.CurrencyPairDCRUSDT` |

Changing any one of them in isolation breaks the rest. This is **not** routed through
the canonical `coinSymbol`/`renderCoinType` helpers (C7).

---

## Section 5 — Critical Constraints

### C1 — Numeric precision (`core/constraints.md` C1)

**The entire `exchanges` package is float64-only.** Examples:

- `BaseState.Price float64`, `BaseState.Volume float64`, `BaseState.Change float64`
  (`exchanges.go:288–296`).
- `xcBot.Conversion(dcrVal float64) *Conversion` (`bot.go:1045`).
- `Conversion.Value float64`.
- `Indices()` returns `map[string]float64`.
- `processState`, `dcrPriceAndVolume`, `indexPrice` all `float64`.

VAR has 8 decimals → safe in `float64`, and `dcrutil.Amount.ToCoin() float64` is the
contract. **There is no SKA path.** Calling `xcBot.Conversion(skaAtomValueAsFloat)` would
truncate to ~15 digits (silent C1 violation). Adding SKA-fiat conversion **requires a new
`*big.Int`- or string-typed API** through the bot, not a reuse of `Conversion`.

### C7 — Centralized coin-type labels

The market page renders `DCR` as a literal string in `market.tmpl` (lines 22, 32, 39, 79
through chart labels in JS). It does **not** call `coinSymbol`. Re-labeling these to
`VAR`/`SKA{n}` would also change the meaning of what is being priced — these labels are
load-bearing for the data, not just UX text.

### C8 — Dual-transport shape asymmetry (`core/constraints.md` C8)

REST `/api/exchanges` returns `ExchangeBotState` (full); WS `"exchange"` returns
`WebsocketExchangeUpdate` (delta-plus-aggregate). Different schemas, different consumers,
both reachable from the same controller. Aligns with the C8 manifestations already
documented for block/transaction/visualblocks.

### Hidden assumption — single-process bot

There is exactly one `*ExchangeBot` per `monetarium-explorer` process. `UpdateChannels()`
mutates the bot's subscriber slice under its own lock; the explorer only ever calls it
once at startup. If a second goroutine called it (e.g. a hot-reload that re-ran
`explorer.New`), every prior subscriber would leak a goroutine reading from a channel that
never closes until process exit.

### Hidden assumption — network-name gate is a Decred legacy

The `activeChain.Name != "mainnet"` guard was meaningful in `dcrdata` (Decred testnet has
`Name: "testnet3"`). On Monetarium it is a no-op — both Decred and Monetarium mainnet
chaincfgs use the literal string `"mainnet"`. The check thus blocks exchange-monitor on
Monetarium testnet/simnet only, not on mainnet.

---

## Section 6 — Mutation Impact

> Detailed mutation analysis lives in [impact.md](impact.md). Headline items:

- **Adding any SKA market** triggers a **silent precision loss** because every primitive
  in `exchanges/` is `float64`. SKA fiat conversion requires a new big.Int API path —
  cannot be done by reusing `Conversion(float64)`.
- **Adding a real Monetarium market (VAR-USDT, SKA1-USDT, …)** requires symmetric edits in
  five disconnected layers (URL strings, pair consts, validators, template literals, JS
  links table). Compile catches the Go edges; the template/JS DCR literals drift silently.
- **Network-name gate** is misleading on Monetarium mainnet — the `"mainnet"` check is a
  no-op. Enabling `exchange-monitor=1` will start the bot and the page will render real
  Decred prices in the Monetarium UI. **Silent content drift.**
- **Disabling `/market` alone does not stop the bot.** The bot is constructed in `main.go`
  independent of the route, and `xcBot.Conversion(...)` is called from ~7 other handlers.
  Full removal is a fan-out edit.
- **Renaming `exchangeUpdateID` ("exchange")** silently disconnects the WS bridge in
  `public/index.js` (handler just never fires). Same for `EXCHANGE_UPDATE`.
- **WS schema (`WebsocketExchangeUpdate`) and REST schema (`ExchangeBotState`) are
  independent contracts** — fields added on one path do not auto-propagate; market controller
  reads from both, so any new field needs three updates (Go REST, Go WS, JS reader).

---

## Section 7 — Common Pitfalls

1. **"The /market page is disabled; we can remove `exchanges/`."**
   No — `xcBot.Conversion(...)` is on the home, tx, and address pages. Drop without
   accompanying handler edits and those pages crash on field-access of the conversions
   struct (which is nil-safe only at the `Conversions == nil` gate, not at field level).

2. **"Add a Monetarium SKA1-USDT entry to `exchanges.go`."**
   Beyond the obvious URL/constant churn: the entire pipeline truncates SKA through
   `float64`. Volumes, prices, depths, candlesticks — all `float64`. You will lose ≥3
   decimal digits of precision per value and the displayed numbers will not match the
   exchange's UI.

3. **"Turn on exchange-monitor for a Monetarium deployment to test the page."**
   The bot will start (the `!= "mainnet"` gate doesn't trigger) and connect to Coinbase,
   Binance, Mexc, dex.decred.org. The page will render **real Decred markets** with
   Monetarium branding. Easy to miss in QA because the numbers look plausible.

4. **"The WS push includes the full state."**
   It doesn't — it's a per-exchange delta with an aggregate price snippet. Filling the
   initial state still requires a template render. If you remove the template render
   path, the page will be blank until the first WS update arrives.

5. **"Renaming `EXCHANGE_UPDATE` in `market_controller.js` is safe — it's the only
   subscriber."**
   It is — but the publisher in `public/index.js:62` uses the literal `'EXCHANGE_UPDATE'`
   too. Two-file change, no compile-time link.

6. **"`xcBot.IsFailed()` means the bot is broken."**
   `IsFailed()` is true when there are zero up-to-date BTC sources **or** zero up-to-date
   DCR sources — not when the bot itself errored. The `stateCopy` may still hold stale
   data and `Conversion()` will still return it (with `Value:0` only if no state has ever
   been populated). The HTML gate `getExchangeState() ⇒ nil` covers this case for
   `/market`; the cross-page conversions do not.

---

## Section 8 — Evidence

Code references supporting the trace above:

- Bot construction + lifecycle:
  [cmd/dcrdata/main.go:413–440](../../../cmd/dcrdata/main.go),
  [exchanges/bot.go:54–96 (struct)](../../../exchanges/bot.go),
  [exchanges/bot.go:295–430 (NewExchangeBot)](../../../exchanges/bot.go),
  [exchanges/bot.go:434–561 (Start)](../../../exchanges/bot.go),
  [exchanges/bot.go:949–976 (updateState)](../../../exchanges/bot.go).
- Configured exchanges + URLs:
  [exchanges/exchanges.go:121–183](../../../exchanges/exchanges.go).
- State snapshot/copy:
  [exchanges/bot.go:111–129](../../../exchanges/bot.go),
  [exchanges/bot.go:646–650 (State)](../../../exchanges/bot.go),
  [exchanges/bot.go:1045–1058 (Conversion)](../../../exchanges/bot.go),
  [exchanges/bot.go:983–987 (IsFailed)](../../../exchanges/bot.go).
- HTML handler + template:
  [cmd/dcrdata/internal/explorer/explorerroutes.go:2513–2531 (MarketPage)](../../../cmd/dcrdata/internal/explorer/explorerroutes.go),
  [cmd/dcrdata/internal/explorer/explorer.go:1047–1052 (getExchangeState)](../../../cmd/dcrdata/internal/explorer/explorer.go),
  [cmd/dcrdata/views/market.tmpl](../../../cmd/dcrdata/views/market.tmpl),
  [cmd/dcrdata/internal/explorer/templates.go:861–867 (xcDisplayName)](../../../cmd/dcrdata/internal/explorer/templates.go).
- WS push:
  [cmd/dcrdata/internal/explorer/explorer.go:984–1045 (watchExchanges)](../../../cmd/dcrdata/internal/explorer/explorer.go),
  [cmd/dcrdata/internal/explorer/websocket.go:372–395 (types + const)](../../../cmd/dcrdata/internal/explorer/websocket.go),
  [cmd/dcrdata/internal/explorer/websocket.go:320–323 (hub fan-out)](../../../cmd/dcrdata/internal/explorer/websocket.go),
  [cmd/dcrdata/internal/explorer/websockethandlers.go:306–322 (encode + send)](../../../cmd/dcrdata/internal/explorer/websockethandlers.go).
- JS bridge + controller:
  [cmd/dcrdata/public/index.js:60–63 (bridge)](../../../cmd/dcrdata/public/index.js),
  [cmd/dcrdata/public/js/services/messagesocket_service.js](../../../cmd/dcrdata/public/js/services/messagesocket_service.js),
  [cmd/dcrdata/public/js/services/event_bus_service.js](../../../cmd/dcrdata/public/js/services/event_bus_service.js),
  [cmd/dcrdata/public/js/controllers/market_controller.js:482–574 (connect)](../../../cmd/dcrdata/public/js/controllers/market_controller.js),
  [cmd/dcrdata/public/js/controllers/market_controller.js:652–716 (fetchChart)](../../../cmd/dcrdata/public/js/controllers/market_controller.js),
  [cmd/dcrdata/public/js/controllers/market_controller.js:1092–1140 (_processXcUpdate)](../../../cmd/dcrdata/public/js/controllers/market_controller.js).
- REST chart cache:
  [cmd/dcrdata/internal/api/apirouter.go:232–243](../../../cmd/dcrdata/internal/api/apirouter.go),
  [cmd/dcrdata/internal/api/apiroutes.go:1987–2030 (chart handlers)](../../../cmd/dcrdata/internal/api/apiroutes.go),
  [cmd/dcrdata/internal/api/apiroutes.go:2138–2203 (exchanges + rates + codes)](../../../cmd/dcrdata/internal/api/apiroutes.go),
  [cmd/dcrdata/internal/api/apiroutes.go:2280–2291 (retrieveCurrencyPair)](../../../cmd/dcrdata/internal/api/apiroutes.go),
  [exchanges/bot.go:1077–1178 (QuickSticks / QuickDepth)](../../../exchanges/bot.go).
- Cross-page conversion callsites:
  [cmd/dcrdata/internal/explorer/explorerroutes.go:199–207 (home)](../../../cmd/dcrdata/internal/explorer/explorerroutes.go),
  [cmd/dcrdata/internal/explorer/explorerroutes.go:768–769 (address)](../../../cmd/dcrdata/internal/explorer/explorerroutes.go),
  [cmd/dcrdata/internal/explorer/explorerroutes.go:1357–1359 (tx)](../../../cmd/dcrdata/internal/explorer/explorerroutes.go),
  [cmd/dcrdata/internal/explorer/explorerroutes.go:1501–1517 (treasury — gated 410)](../../../cmd/dcrdata/internal/explorer/explorerroutes.go).
- Config + nav:
  [cmd/dcrdata/config.go:163–167](../../../cmd/dcrdata/config.go),
  [cmd/dcrdata/sample-dcrdata.conf:88–99](../../../cmd/dcrdata/sample-dcrdata.conf),
  [cmd/dcrdata/views/extras.tmpl:86](../../../cmd/dcrdata/views/extras.tmpl) (nav link to `/market`).
- Monetarium chain Name == "mainnet": `monetarium-node/chaincfg@v1.1.0/mainnetparams.go:84`
  (vendored module, not in repo tree).

See also:
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1 numeric precision, C7 coin-label centralization, C8 dual-transport asymmetry)
- [/wiki/core/pages.md](../../core/pages.md) (depends-on: `/market` is listed under "Should be disabled")
- [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md) (shares-pattern-with: out-of-band shared `pageData`/`invs` state — here the shared state is `xcBot`)
- [/wiki/code-analysis/visualblocks/flow.full.md](../visualblocks/flow.full.md) (shares-pattern-with: C8 dual-transport schema divergence)
- [/wiki/code-analysis/attack-cost/flow.full.md](../attack-cost/flow.full.md) (shares-pattern-with: another VAR-only, exchange-bot-coupled handler — `attack-cost` reads `HomeInfo.PriceConversion` written by `Store` from `xcBot`)
