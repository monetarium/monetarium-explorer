# WebSocket Transport — Mutation Impact

Blast radius for changes to the explorer `/ws` transport. Each risk lists its
trigger, failure mode (silent / loud), and the sites that must move together.

## R1 — Event-name drift (silent)
**Trigger:** rename or add an event without updating all string sites.
**Sites:** `eventIDs` + `Subscriptions`
([pubsub_types.go:121-147](../../../pubsub/types/pubsub_types.go#L121-L147)); the
send-loop `case` and/or reader `case`
([websockethandlers.go:133,279](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L133));
the `+"Resp"` suffix the controller listens for; every `registerEvtHandler('<name>')`;
the pubsub `/ps` twin. **Failure:** no compile error; the handler simply never
fires and the UI silently stops updating. The `decodetx`/`sendtx` pair already
spans 5 sites — see [/wiki/code-analysis/decodetx/impact.md](../decodetx/impact.md) R1.

## R2 — New push signal not wired through `run()` (mixed)
**Trigger:** add a `case sigX` to the send loop but the hub `run()` doesn't fan
that signal to client spokes (it deliberately skips `sigNewTx`, `sigAddressTx`,
`sigSubscribe/Unsubscribe` — [websocket.go:236-251](../../../cmd/dcrdata/internal/explorer/websocket.go#L236-L251)).
**Failure:** the client never receives it (silent). The mirror trap: a signal that
reaches the send loop with **no** matching `case` hits `default` → `Unhandled
signal` log and the client gets `Message:"error"` (loud in logs, silent in UI).

## R3 — `/ws` ↔ `/ps` ↔ HTTP payload drift (silent under load)
**Trigger:** change a payload struct/JSON tag on one transport only.
**Failure:** initial render (HTTP) and live update (WS) disagree; or `/ws` and
`/ps` clients see different shapes. Manifests only under live traffic, never in
`go build`/`go test`. Governed by C2 (dual pipeline) and C8 (dual-transport shape
asymmetry); see [/wiki/core/constraints.md](../../core/constraints.md) and the
`newblock` normalisers in [/wiki/code-analysis/visualblocks/impact.md](../visualblocks/impact.md).

## R4 — SKA-through-float in a payload builder (silent corruption)
**Trigger:** a new encoder reads SKA atoms as `float64` / JS `Number` before the
string boundary. **Failure:** atomic precision truncates (~15 digits) or flips to
scientific notation. The transport itself is pass-through (opaque `Message`
string), so it offers no protection — the discipline must live in the builder.
*Depends-on:* C1.

## R5 — Hub fan-out backpressure change (loud or silent)
**Trigger:** make the spoke send blocking, or resize `make(hubSpoke, 3)` /
`clientSignalSize`. **Failure:** blocking send → one slow client stalls `run()` for
**all** clients (loud, global). Larger buffers → slow clients linger instead of
being unregistered, hiding the problem. See
[websocket.go:263-267](../../../cmd/dcrdata/internal/explorer/websocket.go#L263-L267).

## R6 — Broken connCtx teardown (hard, resource leak)
**Trigger:** remove/short-circuit a `defer cancel()` / `defer closeWS()`, or stop
one goroutine from observing `connCtx.Done()`. **Failure:** reader blocks forever
on `wsjson.Read` (no read deadline by design), goroutines and sockets leak per
dead connection. See [websockethandlers.go:54-66,85-105,374](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L54-L66).

## R7 — Keepalive cadence change / removal (silent leak)
**Trigger:** raise/remove `pingInterval` or the ping goroutine. **Failure:**
half-open connections (dead TCP, classically iOS Safari backgrounded tabs) are no
longer detected; clients are never unregistered; `NumClients()` (and the `ping`
user-count event) inflate; server resources leak. See
[websocket.go:23,172-191](../../../cmd/dcrdata/internal/explorer/websocket.go#L172-L191)
and the per-connection ping at
[websockethandlers.go:85-105](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L85-L105).
Manual coverage: test plan WS-H1/H2.

## R8 — Request size limits (silent drop / hard close)
**Trigger:** send a client request near/over `1<<20`. **Failure:** a frame over
`SetReadLimit(1<<20)` errors the read → connection torn down (client reconnects);
the field-size branch at
[websockethandlers.go:127-131](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L127-L131)
sets a message then `continue`s — **the reply is never sent** (silent). Three
independent limits exist across `/ws`, `/ps`, Insight — see decodetx R2/limits.

## R9 — Reconnect-recovery omissions (silent staleness / leaks)
**Trigger:** a controller consumes a server event but registers no `reconnect`
re-request → UI is stale after any outage. Or it forgets to unsubscribe its
`reconnect`/event handlers in `disconnect()` → handlers accumulate on the singleton
socket, multiplying requests and duplicating DOM rows across reconnects/navigation.
See the per-controller `reconnectUnsub` / `deregisterEvtHandlers` patterns
([homepage_controller.js:117-128](../../../cmd/dcrdata/public/js/controllers/homepage_controller.js#L117-L128)).
Manual coverage: test plan WS-F4/I1/I2.

## R10 — Pre-connect queue overflow & malformed frames (silent)
**Trigger:** issue >5 sends before `connect()` (oldest silently dropped,
`maxQlength=5`); or a non-JSON inbound frame (`onmessage` wraps `JSON.parse` in a
`try/catch`, [messagesocket_service.js:141-148](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L141-L148)).
**Failure:** dropped early requests; a malformed frame is dropped with a
`console.warn` and the message loop keeps processing subsequent frames (asserted by
test plan WS-J1).

See also:
- /wiki/code-analysis/websocket/patterns.md (derived-from: these risks follow from P1–P7)
- /wiki/code-analysis/decodetx/impact.md (shares-pattern-with: R1 event-name drift, oversize silent drop, `/ws`↔`/ps` duality)
- /wiki/code-analysis/mempool/impact.md (shares-pattern-with: WS schema drift, Go↔JS drift)
- /wiki/code-analysis/visualblocks/impact.md (depends-on: `newblock` WS shape + client normalisers)
- /wiki/core/constraints.md (depends-on: C1 precision; C2 dual pipeline; C3/C8 parity & shape asymmetry)
- /docs/manual-test-plan-websocket.md (verified-by: manual transport test plan)
