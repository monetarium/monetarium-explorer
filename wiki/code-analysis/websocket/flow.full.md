# WebSocket Transport (explorer `/ws`) — Full Flow

## Section 1 — Overview

This domain traces the **explorer real-time transport**: the generic `/ws`
WebSocket pipe that carries server→client pushes (new block, mempool, new txs,
ping/user-count, sync status) and client→server request/response RPC
(`getmempooltxs`, `getmempooltrimmed`, `getticketpooldata`, `decodetx`, `sendtx`).
It is the shared mechanism that the per-feature domains (`mempool`,
`visualblocks`, `decodetx`, `ticketpool`) ride on; those domains own their
*payloads*, this domain owns the *connection lifecycle, fan-out, framing, and
client dispatch*.

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
  → encode payload by sig.Signal (switch)              (websockethandlers.go:279)
  → wsjson.Write(WebSocketMessage{EventId: sig.String(), Message})
  → browser ReconnectingWebSocket.onmessage
  → JSON.parse → forward(json.event, json.message, handlers)
  → controller handler registered for that event name
```

**Client → server (request / response):**
```
controller ws.send(eventID, msg)
  → JSON.stringify({event, message})
  → (preConnectQueue if connection===undefined) else connection.send
  → /ws → RootWebsocket reader goroutine: wsjson.Read(&WebSocketMessage)
  → switch msg.EventId { decodetx | sendtx | getmempooltxs |
        getmempooltrimmed | getticketpooldata | ping | default }
  → build webData.Message; webData.EventId = msg.EventId + "Resp"
  → send(webData) → onmessage → forward → controller `<eventID>Resp` handler
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
  2. **Reader** (`:109-247`): `wsjson.Read` in a loop; `switch msg.EventId` builds
     a response; sets `EventId = msg.EventId+"Resp"`; `send(webData)`. `defer
     cancel()` so a read error collapses the connection. Oversize guard at
     `:127-131` sets a message then `continue`s (**response never sent** — silent).
  3. **Send loop** (`:250-377`): `select` over `updateSig` (encode by `sig.Signal`,
     `:279-365`), `wsHub.quitWSHandler`, and `connCtx.Done()`.
- **`send` closure** (`:68-81`): `wsjson.Write` under a `wsWriteTimeout` context;
  on failure returns an error that collapses the loop.
- **Helpers:** `buildTicketPoolChartsData` (`:388`) mirrors the REST handler so
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
  reconcilers (see `visualblocks`).
- **HTTP vs `/ws` vs `/ps` (three contracts).** `getticketpooldata` mirrors
  `/api/ticketpool/charts`; mempool/block payloads have HTTP-trimmed vs WS-full
  shapes. These must move together (C2, C8).
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
  events; real-time vs static (DB/API) paths must change symmetrically.
- **C3 (template + WS parity)** and **C8 (dual-transport shape asymmetry).** A
  field added to a server template must also be added to the WS payload *and* the
  consuming controller, or new entities (arriving by WS) silently miss it while
  initial-render entities show it. C8 names the existing per-page asymmetries.
- **C4 (array stability).** The pubsub layer flattens maps→sorted arrays for the
  wire; the explorer `/ws` still sends some maps (e.g. `coin_stats` keyed by
  coin-type id) that controllers iterate — order is the controller's
  responsibility there.
- **Single-coin / fee-coin invariants** are payload concerns, preserved by
  pass-through.

## Section 6 — Mutation Impact

When modifying the transport, check:

- **Add a server→client push:** add a `case sigX` to the send-loop `switch`
  ([websockethandlers.go:279](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L279)); ensure
  `HubRelay`/`run()` actually fans the signal to client spokes (it skips
  `sigNewTx`, `sigAddressTx`, `sigSubscribe/Unsubscribe`); register a matching
  handler in the consuming controller using the exact `eventIDs` string; mirror on
  `/ps` if the data is shared (C2). **Missing send-loop case → `Unhandled signal`
  log and the client receives `Message:"error"` (loud-ish in logs, silent in UI).**
- **Add a client→server request:** add a `case "<id>"` to the reader `switch`
  ([:133](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L133)); the
  server always replies on `<id>+"Resp"`; the controller must `registerEvtHandler('<id>Resp')`
  and `ws.send('<id>', …)`. Unknown ids hit `default` → logged + ignored (silent
  to the client).
- **Rename an event:** update `eventIDs`/`Subscriptions`
  ([pubsub_types.go](../../../pubsub/types/pubsub_types.go)), the send-loop/reader
  arms, every `registerEvtHandler`, and the `/ps` twin. No compiler help — pure
  string match.
- **Touch reconnect recovery:** a controller that registers a server-event handler
  but no `reconnect` re-request goes stale after an outage (silent); one that
  forgets to unsubscribe its `reconnect` handler in `disconnect()` leaks handlers
  and multiplies requests across reconnects.
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
missing `reconnect` re-request leaves stale UI after an outage.

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
  silently and only show under live load.
- Sending app-level pings from the client (unnecessary — keepalive is
  protocol-level; the `ping` *event* is server→client user-count only).

## Section 8 — Evidence

- Route: [main.go:663](../../../cmd/dcrdata/main.go#L663).
- Handler: [websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go)
  — accept/read-limit `:39-50`, `connCtx` `:54`, `send` `:68-81`, ping goroutine
  `:85-105`, reader+switch `:109-247` (oversize `:127-131`, `+"Resp"` `:241`),
  send loop+switch `:250-377`, `buildTicketPoolChartsData` `:388`.
- Hub: [websocket.go](../../../cmd/dcrdata/internal/explorer/websocket.go)
  — constants `:16-34`, sig aliases `:38-47`, `WebSocketMessage` `:51-54`,
  `RegisterClient` `:124`, `NumClients` `:112`, `pingClients` `:172-191`, `run()`
  `:201-322`, `maybeSendTxns`/buffer `:327-366`.
- Event-id map: [pubsub_types.go:121-147](../../../pubsub/types/pubsub_types.go#L121-L147).
- Client service: [messagesocket_service.js](../../../cmd/dcrdata/public/js/services/messagesocket_service.js)
  — `reconnectOptions` `:32-39`, `forward` `:41-46`, `send`/queue `:78-92`,
  `connect`/synthetic events `:94-128`, `close` `:131-133`.
- Bootstrap: [index.js:37-61](../../../cmd/dcrdata/public/index.js#L37-L61).
- Consumers: [connection_controller.js](../../../cmd/dcrdata/public/js/controllers/connection_controller.js),
  [homepage_controller.js:77-128](../../../cmd/dcrdata/public/js/controllers/homepage_controller.js#L77-L128),
  [mempool_controller.js:264-321](../../../cmd/dcrdata/public/js/controllers/mempool_controller.js#L264-L321),
  [visualBlocks_controller.js:354-382](../../../cmd/dcrdata/public/js/controllers/visualBlocks_controller.js#L354-L382),
  [ticketpool_controller.js:149-222](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L149-L222),
  `status_controller.js:79`.
- Automated coverage: `messagesocket_service.test.js`, `connection_controller.test.js`,
  `websockethandlers_test.go`.

See also:
- /wiki/code-analysis/mempool/flow.full.md (shares-pattern-with: dual-transport WS delivery of `mempool`/`newtxs`)
- /wiki/code-analysis/visualblocks/flow.full.md (depends-on: WS `newblock` shape + client-side normalisers)
- /wiki/code-analysis/decodetx/flow.full.md (shares-pattern-with: RPC-over-WS request/response; documents the `/ps` twin)
- /wiki/code-analysis/ticketpool/flow.full.md (depends-on: `getticketpooldata`→`Resp` mirrors REST)
- /wiki/core/constraints.md (depends-on: C1 precision pass-through; C2 dual pipeline; C3/C8 template↔WS parity & shape asymmetry; C4 array stability)
- /docs/manual-test-plan-websocket.md (verified-by: manual transport test plan — connect/reconnect/keepalive/buffering)
