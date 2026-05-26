# Transaction Mutation Impact

Based on the architectural patterns tracing transaction behaviors, the monetary domain operates utilizing bifurcated pipelines depending on whether an event is confirmed or pending. This document maps exactly how changes propagate and where they typically fail.

## Propagation Layers

When a transaction data structure or multi-coin mechanism is modified, the change propagates through the following distinct layers—many of which do not share code:

1. **Ingestion Layer (Unconfirmed)**: `mempool/monitor.go` parsing raw hexadecimal blocks into standard variable formats.
2. **Aggregation Layer (Unconfirmed)**: `mempool/collector.go` and `txhelpers/txhelpers.go` summarizing output logic into structures like `explorer/types/explorertypes.go:MempoolTx` and assigning the single-coin total directly to a property (`SKATotals: map[uint8]string`).
3. **RPC Interception (Confirmed)**: `db/dcrpg/pgblockchain.go:GetAPITransaction` parsing the underlying node's verbose JSON structure into REST structs: `api/types/apitypes.go:TxShort` and nested arrays of `Vout`.
4. **Broadcast Layer**: `pubsub/pubsubhub.go` pruning transaction definitions and actively pushing sub-set types over socket connections (`TrimmedMempoolTx`).
5. **Static UI Presentation Layer**: `cmd/dcrdata/views/tx.tmpl` and `cmd/dcrdata/views/home_mempool.tmpl` executing Go-side processing to render historic state for a page load.
6. **Dynamic JS Presentation Layer**: `cmd/dcrdata/public/js/controllers/homepage_controller.js` processing live DOM injections relying on the exact HTML classes defined in the `<template>` shards (e.g. `id="home-mempool-tx-row-template"`).

## Failure Modes

### 💥 Loud Failures (Compile or API Errors)
*   **File:** `api/types/apitypes.go:Vout`
    *   **Risk:** Modifying `Vout` properties. If JSON tags are altered, renamed, or types changed from string representation, downstream REST clients relying on `/api/tx/` will fail schema validations instantly.
*   **File:** `explorer/types/explorertypes.go:MempoolTx`
    *   **Risk:** Modifying struct signature. If the type signature of `SKATotals` changed from `map[uint8]string`, the Go compiler will instantly fail any memory aggregation assignments in `mempool/collector.go`.

### 🔕 Silent Failures (Data Loss or UX Breaks)
*   **File:** `db/dcrpg/pgblockchain.go` (interacting with `txhelpers`)
    *   **Risk:** The Mempool vs. Block Divergence. Suppose you implement a new transaction classification rule via `txhelpers` to aggregate data differently. If you fail to also update the JSON node parser mapping in `pgblockchain.go`, transactions will appear perfect while in the mempool but will silently discard their custom data the exact moment they are persisted to a block.
*   **File:** `cmd/dcrdata/views/tx.tmpl` (interacting with `homepage_controller.js`)
    *   **Risk:** Go-template vs. JS render divergence. `tx.tmpl` already branches per `$.Data.CoinType` and renders the confirmed `/tx/{txid}` page server-side (no WebSocket live-update). The **live mempool** rows on the home page are rendered separately by `homepage_controller.js` cloning `<template>` shards. A new coin-dependent field added to the `tx.tmpl` branches but not to the JS path makes the same tx render correctly on the tx page yet appear broken in the live home-page mempool list until reload — and vice-versa.
*   **File:** `cmd/dcrdata/views/tx.tmpl`
    *   **Risk:** SKA-through-VAR-branch precision corruption. The amount cells route VAR through `float64AsDecimalParts .Amount` and SKA through `skaDecimalParts .ValueRaw` via `{{if eq $.Data.CoinType 0}}`. Routing an SKA value through the VAR/`float64` branch (or deleting the branch) silently outputs zeroes, truncates, or emits scientific notation — 18-dec SKA exceeds float64 (C1).

---

## Safe-Change Checklist

Before concluding any structural mutation involving transactions, coins, or supply chains, verify the following:

- [ ] **Dual-State Verification:** I have validated that my logic functions when a transaction is aggregated live (Mempool/`txhelpers`) AND when it is queried verbatim historically (DB/RPC mapping).
- [ ] **Template Synchronization:** I have extended **both** the VAR and SKA branches of the relevant `{{if eq $.Data.CoinType 0}}` blocks in `tx.tmpl` (server-rendering), not just the VAR/`.Amount` path.
- [ ] **Javascript DOM Clone Synchronization:** I have mapped the equivalent visual logic in my Stimulus controllers (e.g., `homepage_controller.js`) to target and clone `<template>` rows identically to the static render.
- [ ] **Persistent String Safety:** Numeric coin data traverses the API, Database, and Websockets exclusively as `string` or `*big.Int`, never encountering float-based arithmetic.
- [ ] **Vout Array Parity:** My feature correctly addresses output logic when it is heavily nested inside standard `TxShort.Vout[]` elements (API response), AND when it is summed into a property for the transaction's single CoinType via `MempoolTx` (Pub/Sub response).

---

See also:

- /wiki/core/constraints.md#C1 (depends-on: numeric precision & bifurcation — SKA must stay `*big.Int`/string; the `tx.tmpl` VAR-branch float path is the canonical violation site).
- /wiki/code-analysis/mempool/impact.md (shares-pattern-with: "Dual collection path divergence" — per-tx `SKATotals`/fee construction differs between `mempoolTxns` and `TxHandler`, the mempool-side manifestation of the same dual-pipeline class).
- /wiki/code-analysis/address/impact.md (shares-pattern-with: the per-row `{{if eq .CoinType 0}}` render-branch risk class — the address tx-list links to this `/tx/{txid}` page).
