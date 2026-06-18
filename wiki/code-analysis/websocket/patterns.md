# WebSocket Transport — Patterns

Reusable architectural behavior in the explorer `/ws` transport. Payload-specific
patterns live in the per-feature domains (`mempool`, `visualblocks`, `decodetx`,
`ticketpool`); these are the transport-level mechanics.

## P1 — Envelope-and-dispatch with synthetic lifecycle events
Every frame is `WebSocketMessage{ event, message }`
([websocket.go:51-54](../../../cmd/dcrdata/internal/explorer/websocket.go#L51-L54)).
The client keeps a `{event: [handler]}` registry and `forward()`s each inbound
message to the matching handlers, iterating a **copy** of the list so a handler may
unsubscribe itself mid-dispatch
([messagesocket_service.js:41-46](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L41-L46)).
On top of server event names the client synthesizes `open`, `reconnect`, `close`,
`error` so consumers reason about the connection without touching partysocket.
**Constraint:** event names are plain strings shared across Go and JS with no
common enum — they must match exactly (see impact R1).

## P2 — Three-goroutine connection model under one `connCtx`
Each accepted socket runs a **reader**, a **send loop**, and a **ping** goroutine,
all sharing a single `context.WithCancel(ctx)`
([websockethandlers.go:54](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L54)).
Whichever goroutine first decides the connection is dead calls `cancel()`, which
unblocks the others; `defer cancel()` / `defer closeWS()` guarantee teardown.
Liveness is enforced by the ping goroutine, **not** a per-read deadline, so the
reader blocks indefinitely on `wsjson.Read` until ping failure or client close
collapses `connCtx`. **Constraint:** the `defer cancel`/`closeWS` chain is
load-bearing; dropping one leaks a goroutine and a socket.

## P3 — Hub fan-out with unregister-on-backpressure
`run()` delivers a signal to every client with a **non-blocking** channel send;
if the client's buffered spoke (`make(hubSpoke, 3)`) is full, the `default` arm
unregisters that client rather than blocking the hub
([websocket.go:263-267](../../../cmd/dcrdata/internal/explorer/websocket.go#L263-L267)).
This keeps one slow consumer from stalling broadcast to all others.
**Constraint:** the send must stay non-blocking; converting it to a blocking send
couples every client's liveness to the slowest one.

## P4 — RPC-over-WebSocket via `<event>Resp`
Client requests (`getmempooltxs`, `getmempooltrimmed`, `getticketpooldata`,
`decodetx`, `sendtx`) are answered on the same socket with `EventId =
msg.EventId + "Resp"`
([websockethandlers.go:241](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L241)).
Both success and error ride the same `Resp` event; the body is a free string the
controller interprets. `getmempooltxs` also carries a client-supplied inventory id
so the server can short-circuit when the client is already current
([:159-174](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L159-L174)).
**Shared with:** [/wiki/code-analysis/decodetx/patterns.md](../decodetx/patterns.md) (P1 form-shell over WS-RPC).

## P5 — Reconnect-driven state re-request
The first `open` fires `open` only; every later `open` also fires `reconnect`
([messagesocket_service.js:113-119](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L113-L119)).
Each feature controller subscribes to `reconnect` and re-requests the state it may
have missed during the outage (`getmempooltxs` / `getmempooltrimmed` /
`getticketpooldata`). **Constraint:** a controller that consumes a server event
should pair it with a `reconnect` re-request, and must unsubscribe that handler in
`disconnect()` (the registry persists; the singleton socket outlives controllers).

## P6 — Two-layer outbound buffering
Sends issued before `connect()` runs (controllers `send` during Stimulus
`connect`, which precedes the 300 ms-deferred `ws.connect` in `index.js`) are held
in a bounded `preConnectQueue` (cap `maxQlength=5`, oldest dropped) and flushed on
connect; thereafter partysocket's own unbounded `maxEnqueuedMessages` buffers across
reconnects ([messagesocket_service.js:78-105](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L78-L105)).
**Constraint:** the pre-connect cap is small and lossy by design — do not rely on
it for more than the handful of initial requests.

## P7 — Server-side new-tx batching
`sigNewTx` is not broadcast per tx; the hub buffers txs (`newTxBufferSize=5`) and
flushes them as a single `sigNewTxs` either at capacity or on a 5 s ticker, writing
the slice into each client's `newTxs` field
([websocket.go:327-366](../../../cmd/dcrdata/internal/explorer/websocket.go#L327-L366)).
**Constraint:** the broadcast carries a nil `Msg`; the per-client slice is the real
payload — fan-out and per-client state are decoupled here.

## P8 — Client-side liveness watchdog (counterpart to P2)
partysocket only reconnects when the browser fires a `close`/`error` event. A
**silently** dropped socket (offline tab, backgrounded iOS Safari, network
partition) never gets one — it lingers in `OPEN`, partysocket never retries, and
the UI shows a stale "Connected". The client mirrors the server's ping-based
zombie detection (P2) with a passive watchdog: any inbound frame re-arms a timer
([messagesocket_service.js:72-86](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L72-L86)),
re-armed on `onopen`/`onmessage` and cleared on `onclose`/clean `close()`
([:136-159](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L136-L159)).
After `livenessTimeout` (90 s) of silence it forces `connection.reconnect()`,
which drops the zombie and emits the synthetic `close` — surfacing the
disconnect to the indicator (P1) and driving the re-request flow (P5). The
watchdog stays **passive**: it never sends a client→server frame, so the
"client sends no app-level pings" contract holds; the inbound app-level `ping`
(broadcast every 60 s by P2's ticker) is the guaranteed proof-of-life that keeps
it from firing on a healthy connection. **Constraint:** `livenessTimeout` must
stay above the server's 60 s ping cadence (with margin) or healthy connections
false-positive; the timeout handler must **not** re-arm (that would reset
partysocket's backoff every cycle) — a successful `onopen` re-arms it instead.

## P9 — Pull-refresh via `getlatestblocks`

On reconnect or on detection of a height gap (a `newblock` push with
`block.height > lastHeight + 1`), block-table controllers issue a
`getlatestblocks` WS request with their page size. The server runs
`clampLatestBlocksSpan` → `latestExplorerBlocks` and replies on
`getlatestblocksResp` with `[]*BlockBasic` (newest first). The client rebuilds
the entire table from this authoritative list, filling any blocks missed during
disconnection. Because `forward()` delivers every `getlatestblocksResp` to
*all* registered handlers, `time_controller.js` piggybacks on the block-table
controllers' request on pages that have a live block table, reading `blocks[0]`
to resync the footer Age stamp. On pages without such a controller it self-issues
the request on `reconnect`.

Three invariants enforce correctness:
1. **Span cap (`maxExplorerRows=400`)** — `clampLatestBlocksSpan` enforces this;
   without it any unauthenticated socket could trigger a tip-to-genesis DB scan.
2. **`homeBlocksSpan` single source** — `Home()` and `latestExplorerBlocks()` both
   reference the same `const homeBlocksSpan = 8`; server-render and WS-refresh
   always return the same window.
3. **`isLatestValue` gate** — `blocks_controller` wires reconnect/refresh handlers
   only when `isLatestValue=true`; historical pages stay static.

**Shared with:** [/wiki/code-analysis/block/patterns.md](../block/patterns.md)
(pull-on-gap pattern for the home and /blocks tables).

See also:
- /wiki/code-analysis/websocket/impact.md (depends-on: these patterns define the mutation risks)
- /wiki/code-analysis/decodetx/patterns.md (shares-pattern-with: RPC-over-WS)
- /wiki/code-analysis/mempool/patterns.md (shares-pattern-with: dual-transport WS, rAF indicator batching downstream of P1)
- /wiki/code-analysis/block/patterns.md (shares-pattern-with: pull-on-gap getlatestblocks)
- /wiki/core/constraints.md (depends-on: C2 dual pipeline; C3/C8 parity & shape asymmetry)
