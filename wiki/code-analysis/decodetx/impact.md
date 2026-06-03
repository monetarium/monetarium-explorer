# `/decodetx` — Mutation Impact

Blast radius for changes to the `/decodetx` page, the `decodetx`/`sendtx` WS events, and the underlying `DecodeRawTransaction` / `SendRawTransaction` data-source methods.

## R1 — Event-string drift across five sites

**Trigger:** renaming `"decodetx"` or `"sendtx"` (or their `Resp` suffix).

**Affected sites (all must change together):**

- HTML form `data-event-id` attributes: textarea, Decode button, Broadcast button in [cmd/dcrdata/views/rawtx.tmpl:15,22,29](../../../cmd/dcrdata/views/rawtx.tmpl#L15).
- Explorer WS `switch` arms: [cmd/dcrdata/internal/explorer/websockethandlers.go:134](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L134), [:150](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L150).
- Pubsub WS `switch` arms: [pubsub/pubsubhub.go:290](../../../pubsub/pubsubhub.go#L290), [:308](../../../pubsub/pubsubhub.go#L308).
- `pstypes.eventIDs` map: [pubsub/types/pubsub_types.go:134-136](../../../pubsub/types/pubsub_types.go#L134-L136) (`SigDecodeTx`, `SigSendTx`).
- JS handler registration / deregistration: [cmd/dcrdata/public/js/controllers/rawtx_controller.js:11,16,24-25](../../../cmd/dcrdata/public/js/controllers/rawtx_controller.js#L11-L25).

**Failure mode:** silent. A typo in any one site routes to the `default` case server-side (which logs `"Unrecognized event ID"` and skips response) or to no handler at all client-side (the `forward` helper short-circuits when `handlers[event] === undefined`). The Decode/Broadcast button just appears to do nothing.

**Description:** the event string is an unstructured contract. There is no compile-time check between the template `data-event-id`, the Stimulus controller's `registerEvtHandler` argument, and the Go `switch` constant. The `+ "Resp"` suffix is purely server-appended ([websockethandlers.go:241](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L241)).

## R2 — Oversize request silently dropped

**Trigger:** any path that sends `> 1 MB` over `/ws` (including pasting a large blob into the decode textarea).

**Affected flow:** [cmd/dcrdata/internal/explorer/websockethandlers.go:127-131](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L127-L131).

**Failure mode:** silent. Code path:

```go
if len(msg.Message) > requestLimit {
    log.Debug("Request size over limit")
    webData.Message = "Request too large"
    continue   // ← jumps back to ws.Receive; never reaches webData.EventId = msg.EventId + "Resp"
}
```

Because `webData.EventId` is only set in the trailing block (after the `switch`), the response is never sent. The client sees no `decodetxResp`/`sendtxResp` and the result `<pre>` stays empty. The result UX is identical to "WebSocket disconnected" or "server hung", but logs only show a `Debug` line.

**Description:** the early-exit kills the response framing along with the request handling. Fixing this in isolation (e.g. setting `webData.EventId = msg.EventId + "Resp"` before `continue`) is safe but small; the broader fix is moving the size check into the per-case block so it can produce a proper structured error.

## R3 — Dual-pipeline drift between `/ws` and `/ps` handlers

**Trigger:** changing the decode or send handler in one of the two WS servers (explorer or pubsub) without changing the other.

**Affected flows:**

- [/wiki/code-analysis/decodetx/flow.full.md](flow.full.md) §3.3 (explorer), §3.6 (pubsub).
- Implementations: [cmd/dcrdata/internal/explorer/websockethandlers.go:134-157](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L134-L157) vs [pubsub/pubsubhub.go:290-316](../../../pubsub/pubsubhub.go#L290-L316).

**Failure mode:** silent for third-party pubsub clients (the browser-facing flow is unaffected; the divergence shows up only against `/ps` consumers). C2-class.

**Description:** the two handlers are structurally similar but not identical:

| Aspect              | `/ws` (explorer)                                  | `/ps` (pubsub)                                                                       |
|---------------------|---------------------------------------------------|--------------------------------------------------------------------------------------|
| Envelope            | `{EventId, Message: <string>}`                    | `pstypes.ResponseMessage{ID, RequestID, Data: <string>, Success: bool}`              |
| Success Data        | pretty-indented JSON string                       | pretty-indented JSON string                                                          |
| Error string prefix | `"Error: %v"`                                     | `"error: %v"` (lowercase, with `Success: false`)                                     |
| Size budget         | `requestLimit := 1 << 20` (hard-coded local)      | `psh.wsHub.requestLimit` (config-driven)                                             |
| `Success` flag      | n/a (string-only)                                 | explicit boolean — set `true` only on success                                        |

A refactor that only touches one side leaves the other speaking a stale dialect.

## R4 — Interface signature fan-out

**Trigger:** changing the signature of `DecodeRawTransaction` or `SendRawTransaction`.

**Affected sites:**

- Interface decl (explorer): [cmd/dcrdata/internal/explorer/explorer.go:107-108](../../../cmd/dcrdata/internal/explorer/explorer.go#L107-L108).
- Interface decl (pubsub): [pubsub/pubsubhub.go:53-54](../../../pubsub/pubsubhub.go#L53-L54).
- Interface decl (insight, send only): [cmd/dcrdata/internal/api/insight/apiroutes.go:51](../../../cmd/dcrdata/internal/api/insight/apiroutes.go#L51).
- Implementation (decode): [db/dcrpg/pgblockchain.go:7345](../../../db/dcrpg/pgblockchain.go#L7345).
- Implementation (send): [db/dcrpg/insightapi.go:49](../../../db/dcrpg/insightapi.go#L49).
- Caller (insight REST send): [cmd/dcrdata/internal/api/insight/apiroutes.go:349](../../../cmd/dcrdata/internal/api/insight/apiroutes.go#L349).
- Mock: [cmd/dcrdata/internal/explorer/explorer_test.go:140-145](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L140-L145).

**Failure mode:** loud (`go build` / `go test` failure). The two interface decls must be kept identical; the test package fails to compile if `mockDataSource` lags.

**Description:** the only sites that consume these methods at runtime are the three transports (`/ws`, `/ps`, `/insight/api/tx/send`); there is no other caller. The mock fan-out is shallow (one type, two methods).

## R5 — SKA precision loss on the response path (latent)

**Trigger:** any code change that reads `*chainjson.TxRawResult.Vout[i].Value` or converts `Vout[i].SKAValue` via `strconv.ParseFloat` / `json.Number.Float64()` *between* the node RPC and the marshaled response.

**Affected flow:** [/wiki/code-analysis/decodetx/flow.full.md](flow.full.md) §3.4, §5.

**Failure mode:** silent. Atom precision drops at the float boundary; the visible JSON in the page `<pre>` shows truncated/zeroed amounts only on SKA Vouts (`CoinType != 0`).

**Description:** the current flow is precision-safe by virtue of being pass-through — the explorer marshals the struct and forwards the string. The node already produces `Value float64 omitempty` (omitted for SKA) and `SKAValue string` (atoms, BigInt-safe). Any helper that hand-reads fields ("let me decorate the response with the address summary…", "let me compute the total…") becomes the first SKA-corruption site on this path. This is C1.

## R6 — Same-event success/error multiplexing

**Trigger:** a change that assumes `decodetxResp` (or `sendtxResp`) signals success.

**Affected sites:** [rawtx_controller.js:11-20](../../../cmd/dcrdata/public/js/controllers/rawtx_controller.js#L11-L20) (current consumer treats body as opaque text — safe), plus any future controller or integration test.

**Failure mode:** silent. Code that, say, parses the response body as JSON will throw on `"Error: <message>"` and report a generic JS error instead of the real backend message.

**Description:** the server uses the same `EventId + "Resp"` for both branches and only signals failure via a `"Error: "` (explorer) or `"error: "` (pubsub) prefix in the body string. The frontend's current "always show 'Decoded tx' as the header" is misleading on the error path but harmless; any future logic that branches on success/failure must inspect the body, not the event name.

## R7 — Receive-loop shared state

**Trigger:** changes to the WS receive goroutine in `RootWebsocket` (the `for { ws.Receive → switch }` loop), `wsReadTimeout`/`wsWriteTimeout`, the `requestLimit` constant, or the `default` case.

**Affected flows:** every page that uses `/ws` — `/`, `/visualblocks`, `/mempool`, `/ticketpool`, plus the connection indicator on every footer.

**Failure mode:** mixed. A panic in any case kills the receive goroutine for that client only (and `closeWS` is `defer`-ed at the top), so the blast is "this tab loses WS until reload". A broader change (locking, signal channel, deadline) leaks into every page-level WS contract.

**Description:** `/decodetx` shares the receive loop with the live-update fan-out (the `loop:` switch below the receive goroutine). The two halves run as separate goroutines per client but share the `ws *websocket.Conn`, `clientData`, and `closeWS` closure. Be careful when adding new cases that touch shared state (locks, the mempool inventory, `exp.pageData`).

## R8 — Legacy `/explorer/decodetx` redirect

**Trigger:** renaming or removing the `/decodetx` route.

**Affected sites:** [cmd/dcrdata/main.go:750](../../../cmd/dcrdata/main.go#L750) (canonical) and [cmd/dcrdata/internal/explorer/explorer.go:958](../../../cmd/dcrdata/internal/explorer/explorer.go#L958) (`exp.Mux.Get("/decodetx", redirect("decodetx"))` — serves `/explorer/decodetx` → `/decodetx`).

**Failure mode:** loud (the redirect 308s to a 404).

**Description:** `exp.Mux` is the legacy `/explorer/*` sub-mux. The redirect's argument string `"decodetx"` is used to construct the new target URL inside `redirect(...)`. Don't change one without the other.

## Safe-change checklist

When modifying `/decodetx`:

1. [ ] Did the change touch `data-event-id` strings? Update all five sites (rawtx.tmpl ×3, websockethandlers.go, pubsubhub.go, pstypes.eventIDs, rawtx_controller.js).
2. [ ] Did the change touch the interface? Update both interface decls + `ChainDB` impl + `mockDataSource` + (for send only) the Insight REST caller.
3. [ ] If the change adds an intermediate field read on `*chainjson.TxRawResult`, does it preserve SKA precision? (Use `SKAValue` string, not `Value`, for `CoinType != 0`.)
4. [ ] If the change introduces structured frontend rendering of the response, did it switch from `<pre>.textContent = evt` to C6 template cloning + parsed JSON?
5. [ ] If the change touches the receive loop in `RootWebsocket`, did you verify the live-update side (`loop:`) and every other page that uses `/ws` (homepage, mempool, visualblocks, ticketpool)?
6. [ ] If the change touches the 1 MB limit, did you adjust the pubsub `psh.wsHub.requestLimit` and Insight `iapi.params.MaxTxSize` to match (or document the divergence)?
7. [ ] If the route name or path changed, did you update the `/explorer/decodetx` redirect in `explorer.go:958`?
8. [ ] If the change affects the pubsub or Insight twin, did you preserve their distinct envelopes (`{ID, RequestID, Data, Success}` vs JSON `{txid}`)?

See also:
- /wiki/code-analysis/decodetx/flow.full.md (derived-from)
- /wiki/code-analysis/decodetx/patterns.md (shares-pattern-with: P1 form-shell, P2 three-transport, P3 multi-coin pass-through)
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: shared `RootWebsocket` receive loop)
- /wiki/code-analysis/transaction/impact.md (shares-pattern-with: `*chainjson.TxRawResult.Vout` multi-coin contract)
- /wiki/core/constraints.md (depends-on: C1 SKA precision, C2 dual-pipeline, C6 in-DOM cloning, C7 coin-type labels)
