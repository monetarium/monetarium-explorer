# Decode/Broadcast Tx (`/decodetx`) — Full Flow

## Section 1 — Overview

`/decodetx` is the explorer's only **user-driven write path to the node**. The HTTP handler is a near-empty HTML form: all real work happens over the explorer WebSocket (`/ws`). The page lets a user

- paste a raw transaction hex blob and either **decode** it (RPC `decoderawtransaction`, read-only) or
- **broadcast** it (RPC `sendrawtransaction`, mutates node mempool).

The same operations are exposed over a second WebSocket transport (`/ps`, pubsub) with a different envelope shape, and the broadcast operation is additionally exposed as `POST /insight/api/tx/send`. The page itself uses only `/ws`.

The HTTP handler renders no transaction data — the page is a shell. Unlike block/tx/address pages, there is no template payload, no `commonData` mutation, and no shared `pageData` state. The flow is purely interactive client→server→node→client over a single WS channel.

## Section 2 — End-to-End Data Flow

```
                   HTTP (one-shot, no payload)
Browser ── GET /decodetx ──▶ DecodeTxPage ──▶ templates.exec("rawtx") ──▶ rawtx.tmpl (form only)

                   Interactive: WebSocket /ws
Browser textarea ──▶ rawtx_controller.send(e)
   │   {event: "decodetx" | "sendtx", message: <hex>}
   ▼
messagesocket_service.send ─JSON over WS──▶ RootWebsocket recv goroutine (explorer/websockethandlers.go:109)
                                                │
                            switch msg.EventId  ▼
                            ┌───────────────────────────────┐
                            │ "decodetx" → dataSource       │
                            │   .DecodeRawTransaction       │── ChainDB.DecodeRawTransaction
                            │ "sendtx"   → dataSource       │   (db/dcrpg/pgblockchain.go:7345)
                            │   .SendRawTransaction         │── ChainDB.SendRawTransaction
                            └───────────────────────────────┘   (db/dcrpg/insightapi.go:49)
                                                │                       │
                                                ▼                       ▼
                                  pgb.Client.DecodeRawTransaction   pgb.Client.SendRawTransaction
                                  (RPC: decoderawtransaction)       (RPC: sendrawtransaction, 5s ctx timeout)
                                                │                       │
                                                ▼                       ▼
                              *chainjson.TxRawResult            txhash string
                              json.MarshalIndent → string       "Transaction sent: <hash>" string
                                                │                       │
                                                └───────┬───────────────┘
                                                        ▼
                              webData = {EventId: msg.EventId+"Resp", Message: <body>}
                                                        │
                                                        ▼
                                       websocket.JSON.Send (ws)
                                                        ▼
Browser onmessage ──▶ forward(json.event, json.message) ──▶ rawtx_controller handler
   • "decodetxResp" → header="Decoded tx",   <pre>.textContent = msg
   • "sendtxResp"   → header="Sent tx",      <pre>.textContent = msg
```

The second transport (`/ps`) follows the same RPC path but wraps the response in a richer envelope (`{ID, RequestID, Data, Success}`); see Section 4.

## Section 3 — Per-Layer Breakdown

### 3.1 HTTP page render (server)

**Location:**

- Route: [cmd/dcrdata/main.go:750](../../../cmd/dcrdata/main.go#L750) — `r.Get("/decodetx", explore.DecodeTxPage)`.
- Legacy redirect: [cmd/dcrdata/internal/explorer/explorer.go:958](../../../cmd/dcrdata/internal/explorer/explorer.go#L958) — `exp.Mux.Get("/decodetx", redirect("decodetx"))` (handles `/explorer/decodetx → /decodetx`).
- Handler: [cmd/dcrdata/internal/explorer/explorerroutes.go:1660](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1660) — `DecodeTxPage`.
- Template: [cmd/dcrdata/views/rawtx.tmpl](../../../cmd/dcrdata/views/rawtx.tmpl).

**Data structures:** none. The handler renders with only `*CommonPageData` (navbar/footer chrome, `Tip`, `NetName`, `Links`, etc.):

```go
str, err := exp.templates.exec("rawtx", struct {
    *CommonPageData
}{
    CommonPageData: exp.commonData(r),
})
```

**Transformations:** none specific to this page. The template body has no Go expressions that touch transaction data — the form (`<textarea>`, two buttons, output `<pre>`) is static.

### 3.2 Frontend (Stimulus + WebSocket client)

**Location:**

- Stimulus controller: [cmd/dcrdata/public/js/controllers/rawtx_controller.js](../../../cmd/dcrdata/public/js/controllers/rawtx_controller.js).
- WS client singleton: [cmd/dcrdata/public/js/services/messagesocket_service.js](../../../cmd/dcrdata/public/js/services/messagesocket_service.js).
- WS bootstrap: [cmd/dcrdata/public/index.js:46-50](../../../cmd/dcrdata/public/index.js#L46-L50) — connects to `${proto}://${host}/ws` after a 300 ms delay.
- Connection status UI: [cmd/dcrdata/public/js/controllers/connection_controller.js](../../../cmd/dcrdata/public/js/controllers/connection_controller.js) (page-wide footer indicator).

**Targets** (declared on the form):

| Target               | DOM            | Role                              |
|----------------------|----------------|-----------------------------------|
| `rawTransaction`     | `<textarea>`   | Hex input.                        |
| `decode`             | `<button>`     | Submits `event: "decodetx"`.      |
| `broadcast`          | `<button>`     | Submits `event: "sendtx"`.        |
| `decodeHeader`       | `<h4>`         | Result section title.             |
| `decodedTransaction` | `<pre>`        | Response body (raw text).         |

**Transformations:**

- `send(e)` (controller line 28) is bound to both `keypress` on the textarea (Enter only — `keyCode === 13`) and `click` on either button. It reads `data-event-id` from the source element (`"decodetx"` for textarea+Decode, `"sendtx"` for Broadcast), and calls `ws.send(eventID, this.rawTransactionTarget.value)`.
- The controller wires two response handlers in `connect()`:

  ```js
  ws.registerEvtHandler('decodetxResp', (evt) => {
    this.decodeHeaderTarget.textContent = 'Decoded tx'
    fadeIn(this.decodedTransactionTarget)
    this.decodedTransactionTarget.textContent = evt
  })
  ws.registerEvtHandler('sendtxResp', (evt) => {
    this.decodeHeaderTarget.textContent = 'Sent tx'
    ...
  })
  ```

  Both handlers set `<pre>.textContent = evt` directly — no JSON parsing, no DOM templating, **no C6 cloning** (which is correct because the payload is intentionally a text blob, not structured data).

- `ws.send` (service line 46) JSON-encodes `{event, message}` and pushes it onto a 5-deep pre-connect queue if the socket isn't open yet.
- `ws.connection.onmessage` parses incoming JSON once per frame and dispatches to handlers by `event` string.

### 3.3 WebSocket server — explorer (`/ws`)

**Location:** [cmd/dcrdata/internal/explorer/websockethandlers.go:109-247](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L109-L247) — receive goroutine inside `RootWebsocket`.

**Data structures:**

- Request envelope: `WebSocketMessage{EventId string, Message string}` — `message` is hex on input.
- Server-side budget: `requestLimit := 1 << 20` (1 MB) applied both to `ws.MaxPayloadBytes` and as a length check on `msg.Message`.

**Transformations:**

- `case "decodetx":` calls `exp.dataSource.DecodeRawTransaction(ctx, msg.Message)`. On success, `json.MarshalIndent(tx, "", "    ")` produces a pretty JSON string; that string becomes `webData.Message`. On error, `webData.Message = fmt.Sprintf("Error: %v", err)` (still success-framed — see Section 7).
- `case "sendtx":` calls `exp.dataSource.SendRawTransaction(ctx, msg.Message)`. On success: `webData.Message = fmt.Sprintf("Transaction sent: %s", txid)`. On error: `"Error: %v"`.
- Outbound envelope: `EventId = msg.EventId + "Resp"` (so the response event name is `decodetxResp` / `sendtxResp`); body is serialized via `websocket.JSON.Send`.

### 3.4 Data source — ChainDB

**Location:**

- Interface (explorer-side): [cmd/dcrdata/internal/explorer/explorer.go:107-108](../../../cmd/dcrdata/internal/explorer/explorer.go#L107-L108).
- Interface (pubsub-side): [pubsub/pubsubhub.go:53-54](../../../pubsub/pubsubhub.go#L53-L54).
- Decode impl: [db/dcrpg/pgblockchain.go:7345-7357](../../../db/dcrpg/pgblockchain.go#L7345-L7357) — `ChainDB.DecodeRawTransaction`.
- Send impl: [db/dcrpg/insightapi.go:47-63](../../../db/dcrpg/insightapi.go#L47-L63) — `ChainDB.SendRawTransaction`.

**Transformations:**

- `DecodeRawTransaction`: `hex.DecodeString(txhex)` → `pgb.Client.DecodeRawTransaction(ctx, bytes)` (node RPC). Returns `*chainjson.TxRawResult` (defined in [monetarium-node/rpc/jsonrpc/types/chainsvrresults.go:410](../../../../monetarium-node/rpc/jsonrpc/types/chainsvrresults.go#L410)).
- `SendRawTransaction`: `txhelpers.MsgTxFromHex(txhex)` (parses and validates the wire format) → `context.WithTimeout(ctx, 5*time.Second)` → `pgb.Client.SendRawTransaction(ctx, msg, true)` (the `true` is `allowHighFees`). Returns the broadcast tx hash.

**Multi-coin shape (important for C1):** `chainjson.Vout` already has the dual-precision shape required for SKA:

```go
type Vout struct {
    Value        float64            `json:"value,omitempty"`    // VAR only (omitted for SKA)
    SKAValue     string             `json:"skavalue,omitempty"` // SKA only (atoms as string)
    N            uint32             `json:"n"`
    Version      uint16             `json:"version"`
    CoinType     uint8              `json:"cointype"`
    ScriptPubKey ScriptPubKeyResult `json:"scriptPubKey"`
}
```

Because the explorer passes this through verbatim as a JSON blob (it never reads `Value` itself), SKA precision is preserved end-to-end **as long as no future intermediate code calls `*TxRawResult` field accessors and converts SKA atoms via float**.

### 3.5 Mocks

`DecodeRawTransaction` / `SendRawTransaction` have one mock pair:

- [cmd/dcrdata/internal/explorer/explorer_test.go:140-145](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L140-L145) — `mockDataSource`.

Pubsub has no separate mock for these two methods (its test suite does not exercise the decodetx/sendtx branch).

### 3.6 Alternate transports (same RPC, different envelope)

- **Pubsub `/ps`** ([pubsub/pubsubhub.go:290-316](../../../pubsub/pubsubhub.go#L290-L316)): same `case "decodetx" / "sendtx"`, same RPC calls, but the response is a `pstypes.ResponseMessage` (`{ID, RequestID, Data, Success}`) rather than the explorer's flat `{EventId, Message}`. The pubsub branch uses `"error: ..."` (lowercase, no `Error:` prefix) and sets `Success: true` explicitly on the success path.
- **Insight REST `POST /insight/api/tx/send`** ([cmd/dcrdata/internal/api/insight/apiroutes.go:329-364](../../../cmd/dcrdata/internal/api/insight/apiroutes.go#L329-L364)): broadcasts only (no decode). Enforces `iapi.params.MaxTxSize` separately from the WS 1 MB limit, returns `{"txid": "<hash>"}` JSON.

## Section 4 — Cross-Layer Dependencies

| Coupling                          | Where                                                                                            | Notes                                                                                                                          |
|-----------------------------------|--------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| `event` string contract           | Frontend `data-event-id` (rawtx.tmpl:15,22,29) ↔ server `switch msg.EventId` (websockethandlers.go:133) ↔ pubsub `case "decodetx"` (pubsubhub.go:290) ↔ `SigDecodeTx="decodetx"` (pubsub/types/pubsub_types.go:134-136) | Free string. A typo on either side silently routes to the `default` handler ("Unrecognized event ID"); no compile-time check. |
| Response event suffix `"Resp"`     | Server appends in [websockethandlers.go:241](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L241); client registers `decodetxResp`/`sendtxResp` in [rawtx_controller.js:11,16](../../../cmd/dcrdata/public/js/controllers/rawtx_controller.js#L11-L16). | The suffix is the only mechanism distinguishing request from response on the same WS channel. |
| `*chainjson.TxRawResult` shape    | Node ([monetarium-node/.../chainsvrresults.go:410](../../../../monetarium-node/rpc/jsonrpc/types/chainsvrresults.go#L410)) → `pgb.Client.DecodeRawTransaction` → marshaled verbatim to the browser. | Multi-coin shape (`Value` float64 VAR-only + `SKAValue` string SKA-only + `CoinType`) is owned by the node; the explorer doesn't normalize. |
| Two parallel WS handlers          | `RootWebsocket` (explorer) and `pubsubhub.WebSocketHandler` (pubsub) implement `decodetx`/`sendtx` independently. | Duplicate switch arms must change together; the response envelopes (`{event,message}` vs `{ID,RequestID,Data,Success}`) are NOT interchangeable. |
| 1 MB WS read limit                | [websockethandlers.go:48-50,127-131](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L48-L131) (hard-coded `1<<20`); pubsub uses `psh.wsHub.requestLimit`. | Insight REST uses a separate budget (`iapi.params.MaxTxSize`). Three independent size limits, no shared constant. |
| Mock parity                       | `mockDataSource.{DecodeRawTransaction,SendRawTransaction}` (explorer_test.go).                   | If the interface signature changes, the mock must update or the test package fails to compile. |
| WS bootstrap                      | [public/index.js:46-50](../../../cmd/dcrdata/public/index.js#L46-L50) connects to `/ws` and replays a 5-deep queue on `onopen`. | If the user clicks Decode before the socket opens, the message is queued; if more than 5 are queued, the oldest is shifted out silently. |

## Section 5 — Critical Constraints

| ID | Applies how |
|----|-------------|
| **[C1 — numeric precision](../../core/constraints.md#c1-numeric-precision--bifurcation-applies-to-block-tx-frontend)** | Node returns `Vout.Value float64` for VAR only and `Vout.SKAValue string` for SKA (atoms). The explorer passes the struct through `json.MarshalIndent` → string verbatim, so precision is preserved. Any future intermediate processing of `Value` for a SKA Vout (or float conversion of `SKAValue`) is silent corruption. |
| **[C2 — dual pipeline mutation](../../core/constraints.md#c2-dual-pipeline-mutation-applies-to-block-tx)** | Two independent server-side handlers (`/ws` and `/ps`) implement decodetx/sendtx. They share the data-source method but have separate envelope formats, separate size limits, and separate error string conventions. Behavior changes must be applied to both. |
| **[C3 — template/WS parity](../../core/constraints.md#c3-template--websocket-parity-applies-to-block-tx-frontend)** | Out of scope here: the template carries no data. All flow is WS-only, so there is no template/WS divergence risk on this page specifically. |
| **C-implicit — write surface** | This is the **only user-facing write path** in the explorer to the node mempool (`sendrawtransaction`). Authentication/authorization is whatever the WS reverse proxy enforces — there is no per-request gate beyond the 1 MB size check. The textarea is `autofocus` and submits on Enter, so accidental broadcast is a UX consideration. |
| **C-implicit — context lifetime** | `sendtx` uses `context.WithTimeout(ctx, 5*time.Second)` *inside* `ChainDB.SendRawTransaction`; `decodetx` uses the bare request context. A long-running node RPC for decode won't be timed out by the explorer (it relies on `wsReadTimeout`/`wsWriteTimeout` on the WS itself). |

## Section 6 — Mutation Impact

**When modifying anything related to `/decodetx`, check:**

1. **Event-ID strings.** Renaming `"decodetx"` / `"sendtx"` requires changes in **all five** places: rawtx.tmpl `data-event-id` (3 occurrences: textarea, Decode button, Broadcast button — note Enter on textarea also fires `decodetx`), explorer `case` (websockethandlers.go), pubsub `case` (pubsubhub.go), `pstypes.eventIDs` map (`SigDecodeTx`/`SigSendTx`), and rawtx_controller.js `registerEvtHandler` calls (`decodetxResp`/`sendtxResp`). The response suffix `"Resp"` lives only on the server (`msg.EventId + "Resp"`); changing it requires a matching JS rename.
2. **Interface signature.** `DecodeRawTransaction(ctx, txhex string) (*chainjson.TxRawResult, error)` is declared on **both** the explorer's `dataSource` interface (explorer.go:107) and the pubsub `sourceBase` interface (pubsubhub.go:53) — keep them in sync. The implementation is in `ChainDB` (db/dcrpg/pgblockchain.go:7345). Mocks live in explorer_test.go.
3. **Response shape.** `*chainjson.TxRawResult` is the on-the-wire contract (as JSON text). Adding fields server-side is safe — the frontend just dumps the string. Removing or renaming fields breaks any external consumer that *does* parse, including future pages that might decode the same blob.
4. **SKA precision.** The current code path is precision-safe by accident (pass-through string). The moment any intermediate code does `for _, vout := range tx.Vout { ... vout.Value ... }` and treats it as the canonical amount for SKA outputs, it silently corrupts atoms (`Value` is zero/omitted for SKA; `SKAValue` is the real atoms-as-string).
5. **Size limit.** `requestLimit := 1 << 20` is local to `RootWebsocket`. The pubsub side uses `psh.wsHub.requestLimit` (separate value). The Insight REST side uses `iapi.params.MaxTxSize`. A consolidation effort that changes one limit should consider the other two.
6. **Error semantics.** Both success and failure use the same `EventId+"Resp"` channel and the same header text ("Decoded tx" / "Sent tx") on the JS side. The frontend does not distinguish — see Section 7 pitfall 1.
7. **Same-WS shared state.** The `RootWebsocket` connection that carries `decodetx`/`sendtx` *also* carries `newblock`, `mempool`, `newtxs`, etc. Changing the receive loop's request-size handling, error propagation, or `default` case affects every other client (homepage, mempool, visualblocks).

### Silent failures

- **Oversize request (>1 MB):** server sets `webData.Message = "Request too large"` then `continue` — the response is **never sent** because `webData.EventId` is set only in the trailing block. The client just sees nothing happen.
- **`textContent = ''` on a `<textarea>`:** [rawtx_controller.js:34](../../../cmd/dcrdata/public/js/controllers/rawtx_controller.js#L34) clears `textContent` instead of `value`, so the textarea is **not actually cleared** after submit. Cosmetic but persistent.
- **Pre-connect queue overflow:** `messagesocket_service.send` shifts the oldest queued message off when the buffer exceeds `maxQlength=5` ([messagesocket_service.js:113](../../../cmd/dcrdata/public/js/services/messagesocket_service.js#L113)). A rapid retry burst before WS open silently drops earlier attempts.
- **SKA precision** if a future change parses `Value` for SKA Vouts (see C1 above).
- **Pubsub vs explorer drift:** if a fix lands on `/ws` but not `/ps`, third-party tooling speaking the pubsub protocol gets stale behavior.

### Hard failures

- **Bad hex:** `hex.DecodeString` returns an error → `"Error: <message>"` flows back as `decodetxResp` (visible in the result `<pre>`, but heading still says "Decoded tx").
- **Bad wire format on send:** `txhelpers.MsgTxFromHex` errors → `"Error: ..."` as `sendtxResp`.
- **Node RPC timeout (sendtx, 5 s):** `pgb.Client.SendRawTransaction` returns timeout → `"Error: context deadline exceeded"`.
- **Mock-signature mismatch:** changing the interface without updating `mockDataSource` fails `go test ./...` in `cmd/dcrdata/internal/explorer`.

## Section 7 — Common Pitfalls

1. **Assuming `decodetxResp` only fires on success.** The server uses the same event ID for both branches. A controller that styles or auto-parses the response on `decodetxResp` must inspect the message body for the `"Error: "` prefix. The current controller side-steps this by treating the body as opaque text and always showing the "Decoded tx" header — which is misleading on the error path but harmless.
2. **Editing only the explorer's `case "decodetx"`.** The pubsub copy at [pubsub/pubsubhub.go:290](../../../pubsub/pubsubhub.go#L290) is structurally identical and has to track. There is no shared function between them; refactoring into a shared helper would reduce drift risk.
3. **Treating the page like other explorer pages.** There is no `pageData`/`HomeInfo`/`commonData.X` to populate. Adding pre-decoded data to the server-rendered HTML would create the first template→WS parity dependency the page currently lacks (C3 trap).
4. **Using `innerHTML` for the response (violating C6).** The current `<pre>.textContent = evt` is the right call — the response is intentionally raw text and contains potentially user-controlled hex/script content. Replacing it with `innerHTML` would open an XSS surface from a node-decoded `asm` or `addresses` string.
5. **Coupling decode and send signatures.** They look alike but have different return types (`*TxRawResult` vs `string txid`) and different external surfaces (decode is internal-only, send is also exposed on `/insight/api/tx/send`). Don't refactor them behind a shared interface without updating the Insight REST caller.
6. **Forgetting the legacy `/explorer/decodetx` route** ([explorer.go:958](../../../cmd/dcrdata/internal/explorer/explorer.go#L958)). It 308-redirects to `/decodetx`; if the canonical route is renamed, the redirect target must update too.
7. **Cross-tx-coin assumption.** Per CLAUDE.md, a tx is always single-coin. If the decoded blob contains mixed `CoinType` Vouts, treat it as a node-side bug, not a feature; this page surfaces whatever the node returns without normalization.

## Section 8 — Evidence

- Route registration: [cmd/dcrdata/main.go:750](../../../cmd/dcrdata/main.go#L750); legacy redirect [cmd/dcrdata/internal/explorer/explorer.go:958](../../../cmd/dcrdata/internal/explorer/explorer.go#L958); WS routes [cmd/dcrdata/main.go:663-664](../../../cmd/dcrdata/main.go#L663-L664).
- HTTP handler: [cmd/dcrdata/internal/explorer/explorerroutes.go:1658-1674](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1658-L1674).
- Template: [cmd/dcrdata/views/rawtx.tmpl](../../../cmd/dcrdata/views/rawtx.tmpl) (43 lines, no data bindings).
- Explorer WS receive loop & cases: [cmd/dcrdata/internal/explorer/websockethandlers.go:109-247](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L109-L247), cases at lines 134 (`decodetx`) and 150 (`sendtx`).
- Pubsub WS twin: [pubsub/pubsubhub.go:290-316](../../../pubsub/pubsubhub.go#L290-L316); signal constants [pubsub/types/pubsub_types.go:134-136](../../../pubsub/types/pubsub_types.go#L134-L136).
- Data source interface: [cmd/dcrdata/internal/explorer/explorer.go:107-108](../../../cmd/dcrdata/internal/explorer/explorer.go#L107-L108); [pubsub/pubsubhub.go:53-54](../../../pubsub/pubsubhub.go#L53-L54).
- Decode impl: [db/dcrpg/pgblockchain.go:7345-7357](../../../db/dcrpg/pgblockchain.go#L7345-L7357).
- Send impl: [db/dcrpg/insightapi.go:47-63](../../../db/dcrpg/insightapi.go#L47-L63).
- Insight REST send: [cmd/dcrdata/internal/api/insight/apiroutes.go:329-364](../../../cmd/dcrdata/internal/api/insight/apiroutes.go#L329-L364); route [cmd/dcrdata/internal/api/insight/apirouter.go:73](../../../cmd/dcrdata/internal/api/insight/apirouter.go#L73).
- Node Vout/TxRawResult shape: [monetarium-node/rpc/jsonrpc/types/chainsvrresults.go:410-424](../../../../monetarium-node/rpc/jsonrpc/types/chainsvrresults.go#L410-L424) (TxRawResult) and lines 832-841 (Vout multi-coin fields).
- Frontend controller: [cmd/dcrdata/public/js/controllers/rawtx_controller.js](../../../cmd/dcrdata/public/js/controllers/rawtx_controller.js).
- WS client service: [cmd/dcrdata/public/js/services/messagesocket_service.js](../../../cmd/dcrdata/public/js/services/messagesocket_service.js).
- WS bootstrap: [cmd/dcrdata/public/index.js:37-61](../../../cmd/dcrdata/public/index.js#L37-L61).
- Mock data source: [cmd/dcrdata/internal/explorer/explorer_test.go:140-145](../../../cmd/dcrdata/internal/explorer/explorer_test.go#L140-L145).

See also:
- /wiki/code-analysis/transaction/flow.full.md (shares-pattern-with: `*chainjson.TxRawResult`/`Vout` shape consumed by the read-only `/tx` page; same multi-coin Vout contract)
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: WS event-string contract, but `/decodetx` is the inverse — the only page where shared `pageData` is NOT used)
- /wiki/core/constraints.md (depends-on: C1 SKA atoms-as-string preserved via pass-through; depends-on: C2 dual `/ws` + `/ps` handler duplication)
