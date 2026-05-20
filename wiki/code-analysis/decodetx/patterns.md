# `/decodetx` — Reusable Patterns

The `/decodetx` flow is unusual in the codebase: a server-rendered page whose HTML handler carries **no data**, and whose entire interaction model lives on the WebSocket as request/response RPC-over-WS. The patterns below are the reusable shapes worth preserving when adding similar interactive pages (e.g. the existing `/verify-message` POST, or any future "submit-a-blob, get-a-result" tool).

## P1 — HTML form as a pure shell over WS-RPC

**Shape.** The HTTP handler returns a static form bound to a Stimulus controller; the controller serializes form input into `{event, message}` and sends it on the page-wide WS singleton. The server receives on `RootWebsocket`'s `switch msg.EventId`, runs the operation, and replies on `<event>+"Resp"`.

**Why it recurs.** It sidesteps three things the standard page-render path imposes:

- No `pageData` lock contention (the receive goroutine doesn't touch `exp.pageData`).
- No template/WS parity (C3) because the template has no fields to mirror.
- No per-action route (no second `webMux.Post(...)` + CSRF + 308 handling).

**Constraints wherever this pattern is used:**

- The WS connection is **shared with every other page** — `RootWebsocket` also carries `newblock`, `mempool`, `newtxs`, `getmempooltrimmed`, etc. A long-running synchronous case blocks the receive goroutine for that client only (each WS client has its own `go func()`), but a panic does not — it kills the connection for *that client* (defer `closeWS()`).
- The response is delivered on `<event>+"Resp"` (server appends literally `+ "Resp"` to the inbound `EventId`). The frontend must register `<event>Resp` handlers, not `<event>` handlers.
- The 1 MB request limit (`requestLimit := 1 << 20`) lives **inside `RootWebsocket`**; the pubsub twin (`/ps`) has its own `psh.wsHub.requestLimit`. There is no shared constant.
- An oversize message is **silently dropped** (the server sets a message but the trailing send block only runs when `EventId` is set after the switch — see Impact). Operations that need user-visible failure on oversize must either lower their own threshold or wrap the size check before the switch.

Sites: `/decodetx` (this flow), `getmempooltxs` / `getmempooltrimmed` (same receive loop, no HTML form, used by visualblocks & mempool), `getticketpooldata`.

## P2 — Three-transport surface for the same node RPC

**Shape.** A single `ChainDB` method (here: `DecodeRawTransaction`, `SendRawTransaction`) is wrapped by:

- An explorer WS case in `RootWebsocket` (envelope: `{EventId, Message}`, body is a free string).
- A pubsub WS case in `pubsubhub` (envelope: `pstypes.ResponseMessage{ID, RequestID, Data, Success}`, body is structured).
- An Insight REST handler (envelope: JSON, with its own input-size budget).

**Why it recurs.** Different consumer classes (browser, third-party WS subscriber, BTC-Pay-style Insight client) want different envelopes. The shared piece is the `ChainDB` method — the divergent pieces are framing, size limits, and error string conventions.

**Constraints wherever this pattern is used:**

- The interface signature must be declared **twice** (`dataSource` in `cmd/dcrdata/internal/explorer/explorer.go`, `sourceBase` in `pubsub/pubsubhub.go`). Adding a parameter requires updating both; the mocks in `explorer_test.go` must follow.
- The three size budgets are independent. Don't assume changing the explorer WS limit covers the pubsub or Insight sides.
- Error string formats differ: explorer uses `"Error: %v"` (capital E, colon, space); pubsub uses `"error: %v"` (lowercase). Don't normalize without checking external consumers.
- The success-frame contract differs: explorer always responds (success → JSON body; failure → `"Error: ..."` body) on `<event>+"Resp"`; pubsub sets `respMsg.Success` as a boolean alongside `respMsg.Data`. A unified frontend would have to handle both shapes.

Sites: `/decodetx` (decode + send), `getmempooltxs` (mempool read), `getversion`.

## P3 — Multi-coin pass-through via opaque JSON

**Shape.** When the upstream (node RPC) already produces correctly-shaped multi-coin data, the explorer can act as a relay: marshal the struct to JSON, send the string, let the consumer (or no one) parse. The `Vout` shape that travels through `/decodetx` is the canonical example:

```go
type Vout struct {
    Value        float64            `json:"value,omitempty"`    // VAR only
    SKAValue     string             `json:"skavalue,omitempty"` // SKA only (atoms string)
    N            uint32             `json:"n"`
    Version      uint16             `json:"version"`
    CoinType     uint8              `json:"cointype"`
    ScriptPubKey ScriptPubKeyResult `json:"scriptPubKey"`
}
```

**Why it recurs.** Pass-through is the cheapest way to preserve C1 (SKA precision): the explorer never decodes the SKA string to a number, so it cannot lose precision. The same shape lands at `apitypes.Vout` for the read-only `/api/tx/*` and `/api/block/*` paths.

**Constraints wherever this pattern is used:**

- **Do not introduce intermediate field reads** in the Go layer on a `*chainjson.TxRawResult` returned by the node. Touching `Vout[i].Value` on a SKA output (`CoinType != 0`) reads zero (`omitempty` + missing JSON tag); converting `SKAValue` via `strconv.ParseFloat` truncates atoms.
- The frontend must keep treating the response as opaque text (`<pre>.textContent = evt`) — switching to JSON parsing + DOM rendering re-introduces the precision risk *and* makes C6 (template cloning) load-bearing.
- If a future change does need structured access (e.g. to highlight inputs/outputs), the JS side should parse with `JSON.parse` and route SKA fields through `splitSkaAtoms` / `formatAtomsAsCoinString` (the helpers listed in [/wiki/core/constraints.md](../../core/constraints.md#c7-centralized-coin-type-label-rendering-applies-to-block-tx-charts-mempool-address-frontend) C7), never via `Number(...)`.

Sites: `/decodetx` (forward), `/api/tx/{txid}` and `/api/block/{hash}` REST (transaction trees expose `apitypes.Vout` with the same multi-coin shape).

See also:
- /wiki/code-analysis/transaction/patterns.md (shares-pattern-with: opaque pass-through of the same `Vout` multi-coin shape from node → REST)
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: WS event-string contract; `/decodetx` inverts the "shared `pageData`" assumption)
- /wiki/core/constraints.md (depends-on: C1, C2, C4 — multi-coin atom strings preserved by being marshaled, not parsed)
