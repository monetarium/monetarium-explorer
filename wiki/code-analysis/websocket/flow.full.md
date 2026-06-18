# WebSocket Transport (explorer `/ws`) — Full Flow

## Section 1 — Overview

This domain traces the **explorer real-time transport**: the generic `/ws`
WebSocket pipe that carries server→client pushes (new block, mempool, new txs,
ping/user-count, sync status) and client→server request/response RPC
(`getmempooltxs`, `getmempooltrimmed`, `getticketpooldata`, `getlatestblocks`,
`decodetx`, `sendtx`).
It is the shared mechanism that the per-feature domains (`mempool`,
`visualblocks`, `decodetx`, `ticketpool`, `block`) ride on; those domains own
their *payloads*, this domain owns the *connection lifecycle, fan-out, framing,
and client dispatch*.

**Scope boundary.** This is the explorer hub (`RootWebsocket` + `WebsocketHub`),
**not** the separate pubsub server at `/ps` (`pubsub/pubsubhub.go`, envelope
`{ID, RequestID, Data, Success}`). The two are independent transports of largely
the same data — see C2/C8 and `decodetx` for the `/ps` twin.

**Recent migration (this is the current source of truth).** The server moved from
`golang.org/x/net/websocket` (`websocket.Handler`) to
[`coder/websocket`](../../../cmd/dcrdata/internal/explorer/websockethandlers.go);
the client moved from a hand-rolled reconnecting socket to
[`partysocket`](../../../cmd/dcrdata/public/js/services/messagesocket_service.js)
`ReconnectingWebSocket`. Comments in the handler call out the behaviors that were
deliberately preserved across the migration (`OriginPatterns:["*"]` ≙ old
open-origin `websocket.Handler`; `SetReadLimit(1<<20)` ≙ old 1 MiB cap).

**Pull-refresh pattern (added since initial trace).** In addition to pure server
push, the transport now carries a pull-refresh loop: on reconnect or detected
height gap, block-table controllers request `getlatestblocks` to rebuild from
authoritative server data. The response (`getlatestblocksResp`) is a shared
broadcast that multiple controllers consume simultaneously.

## Section 2 — End-to-End Data Flow

**Route:** `webMux.Get("/ws", explore.RootWebsocket)`
([main.go:663](../../../cmd/dcrdata/main.go#L663)).

**Server → client (push):**
```
chain/mempool event
  → blockdata / mempool savers (StoreMPData, Store)
  → WebsocketHub.HubRelay <- HubMessage{Signal}        (websocket.go run())
  → fan-out: per-client hubSpoke channel (*client <- {Signal})
  → RootWebsocket send loop `select { case sig := <-updateSig }`
  → encode payload by sig.Signal (switch)              (websockethandlers.go:303)
  → wsjson.Write(WebSocketMessage{EventId: sig.String(), Message})
  → browser ReconnectingWebSocket.onmessage
  → JSON.parse → forward(json.event, json.message, handlers)
  → controller handler registered for that event name
```

**`newblock` push extra payload note.** The `sigNewBlock` case encodes
`types.WebsocketBlock{Block: &blockCopy, Extra: exp.pageData.HomeInfo}`. As of
this trace, `HomeInfo.CBlockSubsidy` carries the *current* (vote-scaled) PoW
block subsidy (distinct from `NBlockSubsidy`, which is the *next* block subsidy).
The mining controller reads `(ex.cblock_subsidy || ex.subsidy).pow` — a fallback
in case `CBlockSubsidy` is absent (startup window before `CurrentBlockSubsidy`
arrives).

**Client → server (request / response):**
```
controller ws.send(eventID, msg)
  → JSON.stringify({event, message})
  → (preConnectQueue if connection===undefined) else connection.send
  → /ws → RootWebsocket reader goroutine: wsjson.Read(&WebSocketMessage)
  → switch msg.EventId { decodetx | sendtx | getmempooltxs |
        getmempooltrimmed | getticketpooldata | getlatestblocks | ping | default }
  → build webData.Message; webData.EventId = msg.EventId + "Resp"
  → send(webData) → onmessage → forward → controller `<eventID>Resp` handler
```

**`getlatestblocks` pull-refresh (new):**
```
reconnect / gap detected
  → home_latest_blocks_controller / blocks_controller (isLatest page only)
     ws.send('getlatestblocks', pageSize)
  → reader: clampLatestBlocksSpan(msg.Message)        (explorerroutes.go:168)
          → latestExplorerBlocks(ctx, span)            (explorerroutes.go:195)
          → dataSource.GetExplorerBlocks(tip, end)     (one DB round-trip per block)
          → filter zero-value placeholder blocks
          → JSON-encode []BlockBasic
  → wsjson.Write(WebSocketMessage{EventId:"getlatestblocksResp", Message: ...})
  → forward('getlatestblocksResp') → all registered handlers:
      home_latest_blocks_controller._refreshList → rebuildBlockTable
      blocks_controller._refreshList             → rebuildBlockTable
      time_controller._refreshBlocktime          → resync footer Age stamp
```

**Lifecycle (synthetic events, client-only):**
```
connect()  → onopen  → forward('open')   [+ forward('reconnect') if hasConnected]
drop       → onclose → forward('close')
socket err → onerror → forward('error')
```
`reconnect` (fired on every open after the first) is the recovery trigger: each
feature controller re-requests its state on `reconnect`.

**Keepalive (two independent 60 s mechanisms):**
- Per-connection RFC-6455 ping (`ws.Ping`) — protocol keepalive; missed pong
  cancels `connCtx` and tears the connection down
  ([websockethandlers.go:85-105](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L85-L105)).
- Hub `pingClients` broadcast `sigPingAndUserCount` → `"ping"` event whose
  `message` is `NumClients()`
  ([websocket.go:172-191](../../../cmd/dcrdata/internal/explorer/websocket.go#L172-L191)).

## Section 3 — Per-Layer Breakdown

### Layer A — Hub (`websocket.go`)
- **Location:** [cmd/dcrdata/internal/explorer/websocket.go](../../../cmd/dcrdata/internal/explorer/websocket.go).
- **Data structures:** `WebsocketHub` (`clients map[*hubSpoke]*clientHubSpoke`,
  `HubRelay chan hubMessage`, `newTxBuffer`); `hubSpoke = chan hubMessage`;
  `clientHubSpoke{cl *client, c *hubSpoke}`; `client{ newTxs []*MempoolTx }`.
  Signal aliases `sigNewBlock … sigSyncStatus` (`:38-47`).
- **Transformations:** `run()` (`:201`) receives on `HubRelay`, validates, and for
  most signals fan-outs `{Signal}` to every client spoke with a **non-blocking
  send; on backpressure it unregisters the client** (`:263-267`). `sigNewTx` is
  special: it is buffered (`maybeSendTxns` `:327`, buffer size `newTxBufferSize=5`)
  and flushed as `sigNewTxs` either at capacity or every `bufferTickerInterval=5s`
  (`periodicBufferSend` `:349`), copying the buffered slice into each client's
  `newTxs` field and signaling `sigNewTxs` with a nil `Msg` (`:299-318`).
- **Constants:** `wsWriteTimeout=10s` (`:19`), `pingInterval=60s` (`:23`),
  `clientSignalSize=5`.

### Layer B — Connection handler (`websockethandlers.go`)
- **Location:** [RootWebsocket](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L26).
- **Per-connection setup:** registers an `updateSig := make(hubSpoke, 3)` with the
  hub (`:30-34`); `websocket.Accept` with `OriginPatterns:["*"]` (`:39-41`);
  `SetReadLimit(1<<20)` (`:48-50`); `connCtx, cancel := context.WithCancel` shared
  by all three goroutines (`:54`).
- **Three goroutines + main loop, coordinated by `connCtx`:**
  1. **Ping** (`:85-105`): `time.Ticker(pingInterval)`, `ws.Ping(ctx)`; on error
     `cancel()` (tears everything down).
  2. **Reader** (`:109-271`): `wsjson.Read` in a loop; `switch msg.EventId` builds
     a response; sets `EventId = msg.EventId+"Resp"`; `send(webData)`. Oversize
     guard at `:127-131` sets a message then `continue`s (**response never sent**
     — silent). Reader now handles: `decodetx`, `sendtx`, `getmempooltxs`,
     `getmempooltrimmed`, `getticketpooldata`, **`getlatestblocks`** (`:233-255`),
     `ping`, `default`.
  3. **Send loop** (`:274-401`): `select` over `updateSig` (encode by `sig.Signal`,
     `:303-389`), `wsHub.quitWSHandler`, and `connCtx.Done()`.
- **`send` closure** (`:68-81`): `wsjson.Write` under a `wsWriteTimeout` context;
  on failure returns an error that collapses the loop.
- **`getlatestblocks` helpers** (in `explorerroutes.go`):
  - `homeBlocksSpan = 8` (`:159`) — shared constant; `Home()` and
    `latestExplorerBlocks()` both use it so the server-rendered list and the WS
    refresh cannot diverge.
  - `clampLatestBlocksSpan(message string) int` (`:168`) — parses the optional
    page-size argument; non-positive/non-numeric → `homeBlocksSpan`; any value
    >400 → `maxExplorerRows`. Prevents uncapped DB scan.
  - `latestBlocksEnd(height, span) int` (`:181`) — genesis guard (`end < 0 → -1`).
  - `latestExplorerBlocks(ctx, span)` (`:195`) — `GetHeight` + `GetExplorerBlocks`
    + filter zero-value placeholders (empty Hash).
- **Helpers:** `buildTicketPoolChartsData` (`:412`) mirrors the REST handler so
  `getticketpooldata` and `/api/ticketpool/charts` emit the same struct.

### Layer C — Wire envelope
- **Type:** `WebSocketMessage{ EventId string \`json:"event"\`; Message string
  \`json:"message"\` }` ([websocket.go:51-54](../../../cmd/dcrdata/internal/explorer/websocket.go#L51-L54)).
- **`Message` is always a string** — for data payloads it is a JSON document
  *encoded into a string* (the controllers `JSON.parse(evt)` it again). Event names
  come from `HubSignal.String()` → `eventIDs`
  ([pubsub_types.go:131-147](../../../pubsub/types/pubsub_types.go#L131-L147)).

### Layer D — Client service (`messagesocket_service.js`)
- **Location:** [messagesocket_service.js](../../../cmd/dcrdata/public/js/services/messagesocket_service.js); singleton `ws` exported.
- **Data structures:** `handlers {event: [fn]}`; `preConnectQueue` (cap
  `maxQlength=5`); `hasConnected` flag.
- **Transformations:** `connect(uri)` builds `ReconnectingWebSocket(uri, [],
  reconnectOptions)`, flushes `preConnectQueue`, wires `onmessage`/`onopen`/
  `onclose`/`onerror` to `forward(...)`. `send` buffers into `preConnectQueue`
  while `connection===undefined`, else `connection.send`. `registerEvtHandler`
  returns an unsubscribe closure. `reconnectOptions`: min 1 s, max 10 s, grow
  ×1.3, `connectionTimeout` 4 s, `maxRetries`/`maxEnqueuedMessages` = `Infinity`
  (`:32-39`).

### Layer E — Bootstrap & consumers
- **Bootstrap:** [index.js](../../../cmd/dcrdata/public/index.js) — `getSocketURI`
  (`ws`/`wss` from `window.location`), 300 ms `sleep` then `ws.connect` (`:46-50`),
  global `newblock` handler → `globalEventBus 'BLOCK_RECEIVED'` (`:60`).
- **Consumers (event → handler):**
  - `connection_controller.js`: `open`/`close`/`error` → status indicator; `ping`
    → debug log of user count (`:12-29`).
  - `homepage_controller.js` / `mempool_controller.js`: `newtxs`, `mempool`,
    `getmempooltxsResp`; send `getmempooltxs`; **`reconnect` → re-send
    `getmempooltxs`**.
  - `visualBlocks_controller.js`: `getmempooltrimmedResp`, `mempool`
    (→ `getmempooltrimmed`); **`reconnect` → `getmempooltrimmed`**;
    `BLOCK_RECEIVED` for new tiles.
  - `ticketpool_controller.js`: `newblock` → `getticketpooldata`,
    `getticketpooldataResp`; **`reconnect` → `getticketpooldata`**; plus HTTP
    `/api/ticketpool/charts`.
  - `status_controller.js`: `blockchainSync` (sync progress).
  - `home_latest_blocks_controller.js` (new): `BLOCK_RECEIVED` → `applyLiveBlock`
    (gap detection → `ws.send('getlatestblocks', '')`);
    **`reconnect` → `ws.send('getlatestblocks', '')`**;
    `getlatestblocksResp` → `_refreshList` (→ `rebuildBlockTable`).
  - `blocks_controller.js` (new, **latest /blocks page only — `isLatestValue=true`**):
    `BLOCK_RECEIVED` → `applyLiveBlock` (gap detection → `ws.send('getlatestblocks', rowsValue)`);
    **`reconnect` → `ws.send('getlatestblocks', rowsValue)`**;
    `getlatestblocksResp` → `_refreshList`. Historical pages (`isLatestValue=false`)
    wire neither handler.
  - `time_controller.js` (new, footer blocktime resync): listens for
    `getlatestblocksResp` → `_refreshBlocktime` (reads `blocks[0].time` to update
    the footer Age stamp). On reconnect: **self-requests `getlatestblocks` only if
    no live block-table controller is present** (DOM query on
    `[data-controller~="home-latest-blocks"]` / `[data-blocks-is-latest-value="true"]`);
    otherwise it piggybacks on that controller's request, because `forward()`
    delivers every `getlatestblocksResp` to all registered handlers.
  - `mining_controller.js`: reads `(extra.cblock_subsidy || extra.subsidy).pow`
    from the `newblock` WS push for vote-scaled PoW subsidy display.

## Section 4 — Cross-Layer Dependencies

- **Event-name triple coupling (brittle, untyped).** A push works only if three
  independently-edited strings agree: the server `HubSignal` → `eventIDs` mapping,
  the controller's `registerEvtHandler('<name>')`, and (for requests) the
  `msg.EventId + "Resp"` suffix the controller listens for. There is no shared
  enum across Go and JS — drift is silent (handler simply never fires). Cf.
  `decodetx` R1 (the `decodetx`/`sendtx` pair spans 5 sites).
- **Go struct ↔ JS payload (untyped JSON-in-string).** `Message` is an opaque
  string; the JS side `JSON.parse`s it and reads fields by name. Adding/renaming a
  Go JSON tag silently changes the shape the controller sees. The `newblock`
  payload mixes PascalCase (untagged) and snake_case (tagged) fields, which is why
  `visualBlocks_controller.js` carries `normaliseWsBlock`/`normaliseMempool`
  reconcilers (see `visualblocks`). `CBlockSubsidy` serializes as `cblock_subsidy`
  (snake_case tagged in `HomeInfo`) and is read by `mining_controller.js` as
  `ex.cblock_subsidy`.
- **HTTP vs `/ws` vs `/ps` (three contracts).** `getticketpooldata` mirrors
  `/api/ticketpool/charts`; mempool/block payloads have HTTP-trimmed vs WS-full
  shapes. These must move together (C2, C8).
- **`homeBlocksSpan` coupling.** `explorerroutes.go:227` (`Home()`) and
  `explorerroutes.go:200` (`latestExplorerBlocks()`) both reference the same
  `homeBlocksSpan = 8` constant so the server-rendered table and the WS refresh
  always fetch the same range. Breaking this coupling (changing the constant in
  one place only) causes the home table to silently diverge on reconnect.
- **`getlatestblocksResp` shared broadcast.** `forward()` delivers every
  `getlatestblocksResp` to every registered handler simultaneously. `time_controller.js`
  exploits this — it does **not** issue its own request on pages with a live block
  table, relying instead on `home_latest_blocks_controller`'s or
  `blocks_controller`'s request. The detection is a DOM query
  (`[data-controller~="home-latest-blocks"]` / `[data-blocks-is-latest-value="true"]`).
  If those `data-*` attributes change or are removed from the template, the
  time_controller silently stops resyncing on affected pages.
- **Goroutine coupling via `connCtx`.** Reader, send loop, and ping share one
  cancellable context; any one deciding the connection is dead (`cancel()`) must
  unblock the others. Removing a `defer cancel()`/`closeWS()` leaks goroutines and
  sockets.

## Section 5 — Critical Constraints

- **C1 (precision).** The transport is pass-through (opaque `Message` string), so
  SKA precision survives **only because nothing here parses it**. Any payload
  *builder* that funnels SKA atoms through `float64` before encoding silently
  truncates — the risk lives in the per-feature encoders, not the transport, but
  the transport guarantees nothing. *See* [/wiki/core/constraints.md](../../core/constraints.md) C1.
- **C2 (dual pipeline).** Explorer `/ws` and pubsub `/ps` emit the same logical
  events; real-time vs static (DB/API) paths must change symmetrically. The
  `CBlockSubsidy` field is populated in both `explorer.go` and `pubsubhub.go`.
- **C3 (template + WS parity)** and **C8 (dual-transport shape asymmetry).** A
  field added to a server template must also be added to the WS payload *and* the
  consuming controller, or new entities (arriving by WS) silently miss it while
  initial-render entities show it. C8 names the existing per-page asymmetries.
- **C4 (array stability).** The pubsub layer flattens maps→sorted arrays for the
  wire; the explorer `/ws` still sends some maps (e.g. `coin_stats` keyed by
  coin-type id) that controllers iterate — order is the controller's
  responsibility there.
- **Uncapped client span = DoS vector.** Any WS reader case that turns a
  client-supplied numeric argument into a DB range must cap it at `maxExplorerRows`
  (400). `getlatestblocks` enforces this via `clampLatestBlocksSpan`; future RPC
  commands must follow the same pattern.
- **Single-coin / fee-coin invariants** are payload concerns, preserved by
  pass-through.

## Section 6 — Mutation Impact

When modifying the transport, check:

- **Add a server→client push:** add a `case sigX` to the send-loop `switch`
  ([websockethandlers.go:303](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L303)); ensure
  `HubRelay`/`run()` actually fans the signal to client spokes (it skips
  `sigNewTx`, `sigAddressTx`, `sigSubscribe/Unsubscribe`); register a matching
  handler in the consuming controller using the exact `eventIDs` string; mirror on
  `/ps` if the data is shared (C2). **Missing send-loop case → `Unhandled signal`
  log and the client receives `Message:"error"` (loud-ish in logs, silent in UI).**
- **Add a client→server request:** add a `case "<id>"` to the reader `switch`
  ([:133](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L133)); the
  server always replies on `<id>+"Resp"`; the controller must `registerEvtHandler('<id>Resp')`
  and `ws.send('<id>', …)`. If the request takes a client-supplied numeric argument
  that drives a DB range, **cap it at `maxExplorerRows`** via a clamp function.
  Unknown ids hit `default` → logged + ignored (silent to the client).
- **Rename an event:** update `eventIDs`/`Subscriptions`
  ([pubsub_types.go](../../../pubsub/types/pubsub_types.go)), the send-loop/reader
  arms, every `registerEvtHandler`, and the `/ps` twin. No compiler help — pure
  string match.
- **Touch reconnect recovery:** a controller that registers a server-event handler
  but no `reconnect` re-request goes stale after an outage (silent); one that
  forgets to unsubscribe its `reconnect` handler in `disconnect()` leaks handlers
  and multiplies requests across reconnects.
- **Change `homeBlocksSpan`:** must update it in `explorerroutes.go` only (single
  const); both `Home()` and `latestExplorerBlocks()` reference it. Changing the
  home template's `blocks` slice without changing the const diverges the
  server-rendered and WS-refreshed lists silently.
- **Change `CBlockSubsidy` field in `HomeInfo`:** must also update `pubsubhub.go`
  (C2) and the consuming JS (`mining_controller.js`); all three sites share the
  fallback logic `CBlockSubsidy || NBlockSubsidy`.
- **Change hub fan-out (buffer size / blocking send):** the spoke send is
  non-blocking with unregister-on-full (`:263-267`); making it blocking risks
  stalling `run()` for *all* clients (loud); enlarging buffers hides slow clients.
- **Change keepalive cadence / removal:** zombie clients (dead TCP, e.g. iOS
  Safari) accumulate; `NumClients()` inflates; the per-connection teardown that
  the ping triggers no longer fires (silent resource leak).

**Silent failures:** event-name drift; missing controller handler; oversize
request dropped without reply ([:127-131](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L127-L131)); pre-connect queue overflow drops the oldest of >5 early
sends; malformed inbound frame dropped with a `console.warn` and the message loop
continues ([:141-148](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L141-L148));
missing `reconnect` re-request leaves stale UI after an outage; `time_controller`
piggybacking stops working if the live-block-table DOM attributes change.

**Hard failures:** removing `connCtx` cancellation/`defer`s (goroutine + socket
leak); a payload encoder panicking inside the send loop; a blocking spoke send
stalling `run()`.

## Section 7 — Common Pitfalls

- Registering a handler for `"newblock"` but the server sends `"newblock"` only via
  the global producer in `index.js`; per-controller `newblock` handlers must use
  per-handler unsubscribe (cf. `ticketpool_controller` `newblockUnsub`) to avoid
  clobbering the shared producer on `disconnect()`.
- Assuming `open` means "reconnected" — `open` fires on the *first* connect too.
  Reconnect-only logic must use the `reconnect` synthetic event.
- Treating `Message` as already-parsed — it is a JSON **string**; controllers
  `JSON.parse(evt)` it.
- Building a new payload that pushes SKA through `float64`/JS `Number` (C1).
- Editing the explorer `/ws` arm but not the pubsub `/ps` arm (C2) — they drift
  silently and only show under live load. **Applies to `CBlockSubsidy` too:** both
  `explorer.go` and `pubsubhub.go` populate it with a fallback.
- Adding a WS reader case that takes a user-supplied numeric argument and feeds it
  directly into a DB range call — must cap at `maxExplorerRows`. This was the
  uncapped `getlatestblocks` DoS before `clampLatestBlocksSpan` was introduced.
- Setting `isLatest=true` in the template for a historical `/blocks` page — the
  `blocks_controller.js` will wire live-update and reconnect handlers, pushing new
  blocks onto a historical window. The `IsLatest` Go field in the page data
  controls this; it must be `height == bestBlock`.
- Relying on `time_controller.js` to self-request `getlatestblocks` on pages that
  also have a `home-latest-blocks` or latest `blocks` controller — it deliberately
  skips the request there. If you move the live block table out of those controllers,
  the time_controller's footer resync also silently breaks.
- Sending app-level pings from the client (unnecessary — keepalive is
  protocol-level; the `ping` *event* is server→client user-count only).

## Section 8 — Evidence

- Route: [main.go:663](../../../cmd/dcrdata/main.go#L663).
- Handler: [websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go)
  — accept/read-limit `:39-50`, `connCtx` `:54`, `send` `:68-81`, ping goroutine
  `:85-105`, reader+switch `:109-271` (oversize `:127-131`, `getlatestblocks`
  `:233-255`, `+"Resp"` `:265`), send loop+switch `:274-401`,
  `buildTicketPoolChartsData` `:412`.
- `getlatestblocks` helpers: [explorerroutes.go](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)
  — `homeBlocksSpan` `:159`, `clampLatestBlocksSpan` `:161-173`,
  `latestBlocksEnd` `:175-187`, `latestExplorerBlocks` `:189-213`,
  `Home()` uses `latestBlocksEnd(height, homeBlocksSpan)` `:227`.
- Hub: [websocket.go](../../../cmd/dcrdata/internal/explorer/websocket.go)
  — constants `:16-34`, sig aliases `:38-47`, `WebSocketMessage` `:51-54`,
  `RegisterClient` `:124`, `NumClients` `:112`, `pingClients` `:172-191`, `run()`
  `:201-322`, `maybeSendTxns`/buffer `:327-366`.
- Event-id map: [pubsub_types.go:121-147](../../../pubsub/types/pubsub_types.go#L121-L147).
- `CBlockSubsidy` population: [explorer.go:574-580](../../../cmd/dcrdata/internal/explorer/explorer.go#L574-L580),
  [pubsubhub.go:740-756](../../../pubsub/pubsubhub.go#L740-L756).
- Client service: [messagesocket_service.js](../../../cmd/dcrdata/public/js/services/messagesocket_service.js)
  — `reconnectOptions` `:32-39`, `forward` `:41-46`, `send`/queue `:78-92`,
  `connect`/synthetic events `:94-128`, `close` `:131-133`.
- Bootstrap: [index.js:37-61](../../../cmd/dcrdata/public/index.js#L37-L61).
- Consumers: [connection_controller.js](../../../cmd/dcrdata/public/js/controllers/connection_controller.js),
  [homepage_controller.js:77-128](../../../cmd/dcrdata/public/js/controllers/homepage_controller.js#L77-L128),
  [mempool_controller.js:264-321](../../../cmd/dcrdata/public/js/controllers/mempool_controller.js#L264-L321),
  [visualBlocks_controller.js:354-382](../../../cmd/dcrdata/public/js/controllers/visualBlocks_controller.js#L354-L382),
  [ticketpool_controller.js:149-222](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L149-L222),
  `status_controller.js:79`,
  [home_latest_blocks_controller.js](../../../cmd/dcrdata/public/js/controllers/home_latest_blocks_controller.js),
  [blocks_controller.js](../../../cmd/dcrdata/public/js/controllers/blocks_controller.js),
  [time_controller.js](../../../cmd/dcrdata/public/js/controllers/time_controller.js),
  [mining_controller.js:34](../../../cmd/dcrdata/public/js/controllers/mining_controller.js#L34).
- Automated coverage: `messagesocket_service.test.js`, `connection_controller.test.js`,
  `websockethandlers_test.go`, `latest_blocks_test.go`, `explorerroutes_test.go:384`.

See also:
- /wiki/code-analysis/mempool/flow.full.md (shares-pattern-with: dual-transport WS delivery of `mempool`/`newtxs`)
- /wiki/code-analysis/visualblocks/flow.full.md (depends-on: WS `newblock` shape + client-side normalisers)
- /wiki/code-analysis/decodetx/flow.full.md (shares-pattern-with: RPC-over-WS request/response; documents the `/ps` twin)
- /wiki/code-analysis/ticketpool/flow.full.md (depends-on: `getticketpooldata`→`Resp` mirrors REST)
- /wiki/code-analysis/block/flow.full.md (shares-pattern-with: `getlatestblocks` pull pattern; `CBlockSubsidy` in newblock push)
- /wiki/core/constraints.md (depends-on: C1 precision pass-through; C2 dual pipeline; C3/C8 template↔WS parity & shape asymmetry; C4 array stability)
- /docs/manual-test-plan-websocket.md (verified-by: manual transport test plan — connect/reconnect/keepalive/buffering)
