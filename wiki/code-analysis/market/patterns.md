# Market — Patterns

Reusable architectural behavior observed in the `/market` flow. Each pattern names
something already used elsewhere in the codebase (or worth comparing against) so future
mutations can stay consistent.

---

## P1 — Globally-shared optional collector

`*exchanges.ExchangeBot` is constructed in `main.go` once and threaded everywhere as a
nullable pointer (`ExplorerConfig.XcBot`, `appContext.XcBot`). Every consumer applies the
same guard:

```go
if exp.xcBot != nil {
    conversions = &homeConversions{
        ExchangeRate: exp.xcBot.Conversion(1.0),
        ...
    }
}
```

**Where it appears.**
- Home page conversions ([explorerroutes.go:199–207](../../../cmd/dcrdata/internal/explorer/explorerroutes.go))
- Address fiat conversion (line 768)
- Tx page conversions (line 1357)
- Treasury (lines 1501, 1517 — gated by HTTP 410 on the route)
- MarketPage (line 2520)
- REST `/api/exchanges`, `/api/exchangerate`, `/api/exchanges/codes`,
  `/api/chart/market/{token}/{candlestick|depth}`
  ([apiroutes.go:1987–2030, 2138–2203](../../../cmd/dcrdata/internal/api/apiroutes.go))

**Why it recurs.** Exchange data is "nice to have, often unavailable" — the bot may be
disabled, may fail to construct, or may be in the `IsFailed()` state. Pushing the
nullability into every consumer (rather than substituting a stub bot) keeps the failure
mode explicit. Pattern mirrors how `agendaDB`, `proposalsDB`, and `voteTracker` are also
constructed-then-passed-nullable in `main.go`.

**Constraints.**
- Always guard with `if xcBot != nil`. Do not call `xcBot.Method()` unguarded — even
  though `Conversion` is nil-receiver-safe (`bot.go:1046`), most other methods are not
  (`State`, `IsFailed`, `UpdateChannels`, …).
- Disabling a UI route does not disable the bot. Removing the bot is a fan-out edit
  across all consumer files.
- Constructing two bots breaks the lock-free snapshot assumption — `State()` returns a
  pointer that is mutated only by the writer, and there is exactly one writer per bot.

---

## P2 — Dual collection source for one collector

`ExchangeBot.Start` decides at startup whether to consume updates from:

- A **remote DCRRates gRPC master** (`bot.connectMasterBot` →
  `dcrrates.SubscribeExchanges` stream). When connected, the local polling timer is drained
  and never fires. Reconnect loop with backoff
  ([bot.go:441–502](../../../exchanges/bot.go)).
- **Direct per-exchange HTTP poll**, scheduled by `bot.nextTick()` based on `DataExpiry`
  (default 5m, min 5s), with `bot.Cycle()` calling `xc.Refresh()` on stale exchanges
  ([bot.go:503–517, 991–1016](../../../exchanges/bot.go)).

Both sources fan into the **same** `bot.exchangeChan` / `bot.indexChan`; the dispatch loop
(`bot.go:519–561`) doesn't know which produced a given update.

**Where it appears.** Only here. Worth contrasting with `mempool/` where there is a
single collection path with multiple savers (see
[/wiki/code-analysis/mempool/patterns.md](../mempool/patterns.md)).

**Constraints.**
- gRPC mode replaces, not supplements, polling. Don't add per-exchange logic on the
  assumption that `Refresh()` runs.
- Both paths must produce identical `ExchangeUpdate` / `IndexUpdate` shapes — gRPC mode
  goes through `exchangeStateFromProto` ([exchanges.go:325–378](../../../exchanges/exchanges.go))
  which mirrors what each `Refresh()` produces. Adding a field on one path silently
  diverges output.

---

## P3 — Lock-free snapshot read via stateCopy

`updateState()` ([bot.go:949–976](../../../exchanges/bot.go)) does three things under the
bot write lock:

1. Recompute aggregated price + volume.
2. JSON-marshal `currentState` into `currentStateBytes`.
3. Deep-copy `currentState` (`copy()` walks both nested maps,
   [bot.go:111–129](../../../exchanges/bot.go)) and assign to `stateCopy`.

`State()` returns `bot.stateCopy` under an RLock. Because no writer ever mutates
`stateCopy` post-publish, every reader has a stable view.

**Where it appears.** Only here in this code-analysis domain. Compare with
`db/cache`-fronted handlers that hold longer locks across DB reads — those are vulnerable
to render-time lock contention; the market bot avoids it.

**Constraints.**
- Anyone who reads `xcBot.State()` and then mutates the returned struct corrupts the
  shared snapshot for all other readers. Treat the returned pointer as read-only.
- The deep-copy is shallow at the `ExchangeState` level — only the outer two maps are
  duplicated; the inner `*ExchangeState` pointers are shared. Practically safe today
  because writers always replace the entry rather than mutating it in place
  (`bot.currentState.DCRExchanges[token][pair] = update.State`,
  [bot.go:892](../../../exchanges/bot.go)).

---

## P4 — Versioned, lazy-encoded chart cache

`versionedChart{chartID, dataID, chart bytes}` ([bot.go:282–288](../../../exchanges/bot.go))
+ `chartVersions map[string]int`. Cache hit when `cache.dataID == bot.cachedChartVersion(chartID)`
([bot.go:1063–1073](../../../exchanges/bot.go)).

- `incrementChart` ([bot.go:803–810](../../../exchanges/bot.go)) bumps the version
  whenever `updateExchange` sees fresh candlesticks for a `(market, token, bin)` or fresh
  depth for `(market, token, "depth")` ([bot.go:880–887](../../../exchanges/bot.go)).
- `QuickSticks` / `QuickDepth` ([bot.go:1077–1178](../../../exchanges/bot.go)) re-encode
  on miss and stash the new bytes.

**Where it appears.** Only here. The general "lazy-encoded versioned bytes" pattern shows
up in `charts/` for chart payloads but with different mechanics (see
[/wiki/code-analysis/charts/patterns.md](../charts/patterns.md)).

**Constraints.**
- Cache key is built by `genCacheID` (string concat with `-`). Don't introduce tokens that
  contain `-` or you'll alias keys.
- Encoding happens under the bot write lock (`bot.mtx.Lock()` in `QuickSticks`). Heavy
  encodes block writes; for large depth payloads this can starve the dispatch loop. Not
  currently an issue because depth size is bounded by exchange API.

---

## P5 — Untyped WS bridge via globalEventBus

Go const `exchangeUpdateID = "exchange"`
([websocket.go:372](../../../cmd/dcrdata/internal/explorer/websocket.go)) → JS
`ws.registerEvtHandler('exchange', ...)`
([public/index.js:60–63](../../../cmd/dcrdata/public/index.js)) → republished onto
`globalEventBus` as `'EXCHANGE_UPDATE'` → `market_controller.js:569` subscribes.

The WS handler is **registered at SPA entry**, not inside the controller. Other WS events
(`newblock`, `mempool`, `getmempooltrimmedResp`, `decodetxResp`, `getticketpooldataResp`)
are registered **inside** their controllers. The choice here lets `index.js` always carry
exchange updates onto the bus even when no `/market` page is mounted (other listeners
could subscribe in future — currently none do).

**Where it appears.** Similar bus-republish pattern for `'BLOCK_RECEIVED'`
([public/index.js:58](../../../cmd/dcrdata/public/index.js)) — the `newblock` event has
many subscribers (status, address, blocks, home_latest_blocks, newblock, time, tx,
visualBlocks, homepage, mempool), justifying the bridge. For `EXCHANGE_UPDATE` the single
subscriber means the bridge is currently overkill, but harmless.

**Constraints.**
- Four string contracts in two JS files (`'exchange'` event-id, `'EXCHANGE_UPDATE'` bus
  event, the controller's `on(...)`/`off(...)` pair). Renaming requires multi-file edit
  with no compile-time link.
- If a new page wants live exchange updates, it should subscribe to `EXCHANGE_UPDATE`
  rather than registering its own `'exchange'` WS handler (the handler list is
  per-eventID, so multiple WS handlers would each run, but the bus is the established
  contract).
- C8 (dual-transport asymmetry) applies: the WS payload `WebsocketExchangeUpdate` has a
  different shape than the REST `ExchangeBotState`. Any new subscriber that conflates the
  two will break on partial updates.

See also:
- [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md) (shares-pattern-with: out-of-band shared state — bot is the cross-page shared resource here)
- [/wiki/code-analysis/charts/patterns.md](../charts/patterns.md) (shares-pattern-with: lazy-encoded versioned chart cache, different mechanics)
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C7 centralized coin labels, C8 dual-transport asymmetry)
