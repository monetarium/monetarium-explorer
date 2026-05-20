# Decode/Broadcast Tx (`/decodetx`) — Compact

**Flow:** `GET /decodetx` → `DecodeTxPage` → `rawtx.tmpl` (form only, no data); interactive `<textarea>` + Decode/Broadcast buttons → `messagesocket_service.send({event,message})` → `/ws` → `RootWebsocket` `switch msg.EventId` → `dataSource.DecodeRawTransaction`/`SendRawTransaction` (`ChainDB` → node RPC `decoderawtransaction`/`sendrawtransaction`) → JSON pretty-print → `{EventId: <id>+"Resp", Message}` → `rawtx_controller` `<pre>.textContent = evt`. A parallel handler exists at `/ps` ([pubsub/pubsubhub.go:291-317](../../../pubsub/pubsubhub.go#L291-L317)); `sendtx` is also exposed as `POST /insight/api/tx/send`.

**Key architectural patterns:**

- **No-data HTML shell + WS-only data path.** The HTTP handler renders a static form (`*CommonPageData` only). Unlike block/tx/address pages, there is no `pageData` mutation, no template/WS parity contract, no `data-*` payload. All real I/O happens on `/ws`. This is the simplest server-rendered page in the codebase by data surface, and the **only user-driven write path to the node**.
- **Three independent transports of the same RPC.** `decodetx`/`sendtx` are implemented in (1) explorer WS `/ws` (`{EventId, Message}` envelope), (2) pubsub WS `/ps` (`{ID, RequestID, Data, Success}` envelope), and (3) Insight REST `POST /insight/api/tx/send` (broadcast only). They share `ChainDB.{Decode,Send}RawTransaction` but have **separate envelopes, separate size limits (`1<<20` vs `psh.wsHub.requestLimit` vs `iapi.params.MaxTxSize`), and separate error-string conventions**.
- **Same-event success/error multiplexing.** Server responds on `<event>+"Resp"` for both success and failure; the body is a free string. The JS controller treats the body as opaque text — no parsing, no `innerHTML`, no DOM template cloning (correctly, since C6 doesn't apply to raw text dumps).
- **Multi-coin pass-through.** `chainjson.Vout` already has the dual shape (`Value` float64 VAR-only `omitempty` + `SKAValue` string SKA-only + `CoinType`). The explorer marshals `*TxRawResult` to JSON verbatim, so SKA precision is preserved by accident of the data path being read-only.

**Critical constraints:**

- **C1** is preserved by pass-through. Any future intermediate code that reads `Vout.Value` as the canonical amount for a SKA output silently zeros it.
- **C2** dual-pipeline applies: `/ws` and `/ps` handler arms must change together; mocks live only in `explorer_test.go`.
- The 1 MB oversize branch on `/ws` sets a message then `continue`s — **the error never reaches the client** (silent failure).
- This is the **only write surface** in the page tier. No per-request auth/gate beyond size; `autofocus` + Enter on textarea sends `decodetx`, broadcast still requires explicit click.

**Mutation checklist (touching `/decodetx`):**

1. Rename `decodetx`/`sendtx` strings? Update 5 sites: `rawtx.tmpl` `data-event-id` (×3), `websockethandlers.go` case, `pubsubhub.go` case, `pstypes.eventIDs` (`SigDecodeTx`/`SigSendTx`), `rawtx_controller.js` `registerEvtHandler` (`decodetxResp`/`sendtxResp`).
2. Change `DecodeRawTransaction`/`SendRawTransaction` interface? Update **two** interface decls (explorer.go:111, pubsubhub.go:51), `ChainDB` impl in `db/dcrpg/`, `mockDataSource` in `explorer_test.go`, and `iapi.BlockData.SendRawTransaction` caller in `insight/apiroutes.go`.
3. Touch `*chainjson.TxRawResult.Vout`? Confirm `Value omitempty` + `SKAValue` + `CoinType` invariant still holds end-to-end; do NOT introduce float conversion on the SKA path.
4. Adjust size limits? Three independent values (`1<<20` in explorer, `psh.wsHub.requestLimit` in pubsub, `iapi.params.MaxTxSize` in Insight). No shared constant.
5. Add structured data to the response? You'll be the first to depend on the response *shape* (currently it's just text). Either keep `<pre>.textContent` (no XSS surface) or adopt C6 cloning + parsed payload — don't mix.
6. Delete or rename the route? Also update the legacy `/explorer/decodetx → /decodetx` redirect in `explorer.go:980`.
