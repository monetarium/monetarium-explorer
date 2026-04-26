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
    *   **Risk:** Javascript vs. Go Template Conflicts. If you add visibility for the transaction's specific CoinType (like VAR or SKA) to `tx.tmpl`, it will process on the server side correctly on refresh. Without corresponding JS implementation in `homepage_controller.js`, new transactions pushed by the Websocket will inject visually broken lines to the user until they hard-refresh the page.
*   **File:** `cmd/dcrdata/views/tx.tmpl`
    *   **Risk:** Precision and Scientific Notation Corruption. Unintentionally funneling high-precision metrics via a numeric intermediate (`float64`) instead of rigorously passing the payload as strings will cause UI elements leveraging old DCR helpers (e.g., `float64AsDecimalParts` in `tx.tmpl`) to silently output zeroes, truncate decimal points, or use scientific expressions.

---

## Safe-Change Checklist

Before concluding any structural mutation involving transactions, coins, or supply chains, verify the following:

- [ ] **Dual-State Verification:** I have validated that my logic functions when a transaction is aggregated live (Mempool/`txhelpers`) AND when it is queried verbatim historically (DB/RPC mapping).
- [ ] **Template Synchronization:** I have implemented the UI representation inside the static `.tmpl` file (for server-rendering).
- [ ] **Javascript DOM Clone Synchronization:** I have mapped the equivalent visual logic in my Stimulus controllers (e.g., `homepage_controller.js`) to target and clone `<template>` rows identically to the static render.
- [ ] **Persistent String Safety:** Numeric coin data traverses the API, Database, and Websockets exclusively as `string` or `*big.Int`, never encountering float-based arithmetic.
- [ ] **Vout Array Parity:** My feature correctly addresses output logic when it is heavily nested inside standard `TxShort.Vout[]` elements (API response), AND when it is summed into a property for the transaction's single CoinType via `MempoolTx` (Pub/Sub response).
