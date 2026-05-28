# WebSocket Transport (explorer `/ws`) — Compact

**Flow (push):** chain/mempool saver → `WebsocketHub.HubRelay <- {Signal}` →
`run()` non-blocking fan-out to each client `hubSpoke` → `RootWebsocket` send-loop
`switch sig.Signal` encodes payload → `wsjson.Write(WebSocketMessage{event,message})`
→ partysocket `onmessage` → `forward(event,message)` → controller handler.
**Flow (request):** `ws.send(id,msg)` → `{event,message}` JSON → `/ws` reader
`wsjson.Read` → `switch EventId` → reply on `id+"Resp"`. Route:
[main.go:663](../../../cmd/dcrdata/main.go#L663). Separate from the pubsub `/ps`
server (`pubsub/pubsubhub.go`).

**Key patterns:** (1) `{event,message}` envelope + `forward()` registry + synthetic
`open`/`reconnect`/`close`/`error`. (2) Three per-connection goroutines (reader /
send-loop / 60 s ping) coordinated by one cancellable `connCtx`. (3) Hub fan-out
with non-blocking send + **unregister-on-backpressure**. (4) RPC-over-WS via
`<event>Resp` naming. (5) `reconnect` event → each controller re-requests its
state. (6) Two outbound buffers: `preConnectQueue` (cap 5) + partysocket unbounded
enqueue. (7) `newtxs` batched at size 5 or 5 s.

**Constraints:** C1 SKA precision survives only by pass-through (opaque string
`Message`); C2 `/ws`+`/ps` symmetric; C3/C8 template↔WS field parity & shape
asymmetry; C4 array stability.

**Mutation checklist:**
- New push: add send-loop `case`; ensure `run()` fans the signal; register the
  exact `eventIDs` string in the controller; mirror on `/ps`.
- New request: add reader `case`; reply on `+"Resp"`; controller `send`+`<id>Resp`.
- Rename event: `eventIDs`/`Subscriptions` + both hub arms + every
  `registerEvtHandler` + `/ps` (string-only, no compiler help).
- New server event in a controller → also add a `reconnect` re-request **and**
  unsubscribe it in `disconnect()`.
- Never push SKA through float in the payload builder (C1).

See also:
- [/wiki/code-analysis/websocket/flow.full.md](flow.full.md) — full trace.
- [/wiki/code-analysis/websocket/patterns.md](patterns.md) — reusable patterns.
- [/wiki/code-analysis/websocket/impact.md](impact.md) — mutation-impact entries.
- [/wiki/code-analysis/mempool/flow.compact.md](../mempool/flow.compact.md) (shares-pattern-with: dual-transport WS).
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1, C2, C3, C4, C8).
- [/docs/manual-test-plan-websocket.md](../../../docs/manual-test-plan-websocket.md) (verified-by: manual transport test plan).
