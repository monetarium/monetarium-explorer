# Transaction Mutation Impact

Based on the architectural patterns tracing transaction behaviors, the monetary domain operates utilizing bifurcated pipelines depending on whether an event is confirmed or pending. This document maps exactly how changes propagate and where they typically fail.

## Propagation Layers

When a transaction data structure or multi-coin mechanism is modified, the change propagates through the following distinct layers — many of which do not share code:

1. **Ingestion Layer (Unconfirmed)**: `mempool/monitor.go` parsing raw hexadecimal blocks into standard variable formats.
2. **Aggregation Layer (Unconfirmed)**: `mempool/collector.go` and `txhelpers/txhelpers.go` summarizing output logic into structures like `explorer/types/explorertypes.go:MempoolTx` and assigning the single-coin total directly to a property (`SKATotals: map[uint8]string`).
3. **RPC Interception (Confirmed)**: `db/dcrpg/pgblockchain.go:GetAPITransaction` parsing the underlying node's verbose JSON structure into REST structs: `api/types/apitypes.go:TxShort` and nested arrays of `Vout`.
4. **Broadcast Layer**: `pubsub/pubsubhub.go` pruning transaction definitions and actively pushing sub-set types over socket connections (`TrimmedMempoolTx`).
5. **Static UI Presentation Layer**: `cmd/dcrdata/views/tx.tmpl` and `cmd/dcrdata/views/home_mempool.tmpl` executing Go-side processing to render historic state for a page load.
6. **Dynamic JS Presentation Layer**: `cmd/dcrdata/public/js/controllers/homepage_controller.js` processing live DOM injections relying on the exact HTML classes defined in the `<template>` shards (e.g. `id="home-mempool-tx-row-template"`).

## Failure Modes

### 💥 Loud Failures (Compile or API Errors)
- **File:** `api/types/apitypes.go:Vout`
  - **Risk:** Modifying `Vout` properties. If JSON tags are altered, renamed, or types changed from string representation, downstream REST clients relying on `/api/tx/` will fail schema validations instantly.
- **File:** `explorer/types/explorertypes.go:MempoolTx`
  - **Risk:** Modifying struct signature. If the type signature of `SKATotals` changed from `map[uint8]string`, the Go compiler will instantly fail any memory aggregation assignments in `mempool/collector.go`.

### 🔕 Silent Failures (Data Loss or UX Breaks)
- **File:** `db/dcrpg/pgblockchain.go` (interacting with `txhelpers`)
  - **Risk:** The Mempool vs. Block Divergence. Implementing a new transaction classification rule via `txhelpers` without updating the JSON node parser mapping in `pgblockchain.go` causes transactions to appear correct in mempool but silently discard their custom data when persisted to a block.
- **File:** `cmd/dcrdata/views/tx.tmpl` (interacting with `homepage_controller.js`)
  - **Risk:** Go-template vs. JS render divergence. `tx.tmpl` renders the confirmed `/tx/{txid}` page server-side (no WebSocket live-update). The live mempool rows on the home page are rendered separately by `homepage_controller.js`. A new coin-dependent field added to `tx.tmpl` but not the JS path makes the same tx render correctly on the tx page but broken in the live home-page mempool list — and vice-versa.
- **File:** `cmd/dcrdata/views/tx.tmpl`
  - **Risk:** SKA-through-VAR-branch precision corruption. Amount cells route VAR through `float64AsDecimalParts .Amount` and SKA through `skaDecimalParts .ValueRaw` via `{{if eq $.Data.CoinType 0}}`. Routing an SKA value through the VAR/`float64` branch silently outputs zeroes, truncates, or emits scientific notation — 18-dec SKA exceeds float64 (C1).
- **`FeeRaw` semantic overload (NEW):**
  - **Trigger:** Reading `TxBasic.FeeRaw` without checking `IsSSFee()`.
  - **Risk:** For SSFee txs `FeeRaw` = net reward (outputs − inputs, ≥ 0); for regular txs `FeeRaw` = fee (inputs − outputs, ≥ 0). A caller that treats `FeeRaw` as always-a-fee will display a reward as a fee for SSFee txs (or display a normal fee as a reward — both silently wrong).
- **Dual `ssFeeNetReward` implementations (NEW):**
  - **Trigger:** Changing SSFee output structure (e.g. new output field, different value encoding) in only one location.
  - **Files:** `db/dcrpg/pgblockchain.go:ssFeeNetReward` and `txhelpers/ssfee.go:blockSSFeeTotalsInternal`.
  - **Risk:** Block page (calls `ssFeeNetReward`) and txhelpers-level callers disagree on the reward amount — silent, no compile error.
- **SSFee page split (NEW):**
  - **Trigger:** Adding SSFee-specific data to `GetExplorerBlock` but not `GetExplorerTx` (or vice-versa).
  - **Risk:** The block page and the standalone `/tx/{txid}` page have independent SSFee specialization blocks. They must be kept in sync. A field visible on the block page will be absent on the tx page.
- **`MiningFee` scope:**
  - **Trigger:** Adding a new tx type to the `MiningFee` total in `GetExplorerBlock` without updating `internal.SelectFeesPerBlockAboveHeight`.
  - **Risk:** Block header fee value and the Fees chart diverge silently (issue #405). The SQL query is the chart's data source; the Go accumulator is the block page's data source. They must define the same set of contributing txs.

---

## Safe-Change Checklist

Before concluding any structural mutation involving transactions, coins, or supply chains, verify the following:

- [ ] **Dual-State Verification:** I have validated that my logic functions when a transaction is aggregated live (Mempool/`txhelpers`) AND when it is queried verbatim historically (DB/RPC mapping).
- [ ] **`FeeRaw` awareness:** If my change reads or writes `TxBasic.FeeRaw`, I have checked whether the tx is SSFee (net reward) or regular (fee). I have NOT added a `FeeRaw` consumer that assumes it is always-a-fee.
- [ ] **SSFee both-site update:** If my change affects SSFee tx rendering or data, I updated BOTH `GetExplorerBlock` AND `GetExplorerTx` (they are independent).
- [ ] **`ssFeeNetReward` parity:** If I changed `ssFeeNetReward` in `pgblockchain.go`, I applied the same change to `txhelpers/ssfee.go:blockSSFeeTotalsInternal`.
- [ ] **Template Synchronization:** I have extended **both** the VAR and SKA branches of the relevant `{{if eq $.Data.CoinType 0}}` blocks in `tx.tmpl`, not just the VAR/`.Amount` path.
- [ ] **Javascript DOM Clone Synchronization:** I have mapped the equivalent visual logic in Stimulus controllers (`homepage_controller.js`) to target and clone `<template>` rows identically to the static render.
- [ ] **Persistent String Safety:** Numeric coin data traverses the API, Database, and Websockets exclusively as `string` or `*big.Int`, never encountering float-based arithmetic.
- [ ] **Vout Array Parity:** My feature correctly addresses output logic when heavily nested inside `TxShort.Vout[]` elements (API response) AND when summed into `MempoolTx.SKATotals` (Pub/Sub response).
- [ ] **`MiningFee` SQL parity:** If I changed which tx types contribute to the block `MiningFee` total, I updated `internal.SelectFeesPerBlockAboveHeight` to match.

---

See also:

- /wiki/core/constraints.md#C1 (depends-on: numeric precision & bifurcation — SKA must stay `*big.Int`/string; the `tx.tmpl` VAR-branch float path is the canonical violation site).
- /wiki/code-analysis/mempool/impact.md (shares-pattern-with: "Dual collection path divergence" — per-tx `SKATotals`/fee construction differs between `mempoolTxns` and `TxHandler`).
- /wiki/code-analysis/address/impact.md (shares-pattern-with: the per-row `{{if eq .CoinType 0}}` render-branch risk class — the address tx-list links to this `/tx/{txid}` page).
