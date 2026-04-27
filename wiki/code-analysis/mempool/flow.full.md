### Section 1 — Overview
Tracing the data flow of mempool transactions and SKA-specific mempool metrics from the network monitor to the `mempool.tmpl` UI template.

### Section 2 — End-to-End Data Flow
`RPC (raw tx) → mempool/monitor.go (parsing & aggregation) → inventory *MempoolInfo → explorer.go:StoreMPData (derive CoinFills) → explorerroutes.go (Mempool handler) → mempool.tmpl`

### Section 3 — Per-Layer Breakdown
- **Location:** `mempool/monitor.go`
  - **Data Structures:** `msgTx`, `tx.SKATotals`, `inventory.CoinStats`
  - **Transformations:** Parses raw wire transactions into `tx.SKATotals`. Aggregates amounts per SKA coin type into `MempoolCoinStats` strings via `addAtomStrings(..., isBig=true)`.
- **Location:** `cmd/dcrdata/internal/explorer/explorer.go`
  - **Data Structures:** `CoinFills`, `inv *types.MempoolInfo`
  - **Transformations:** `computeCoinFills` computes `GQFillRatio`, `ExtraFillRatio`, etc., using the aggregated `CoinStats` and the block size limit.
- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go`
  - **Data Structures:** `MempoolInfo`
  - **Transformations:** Hands the `MempoolInfo` struct to `mempool.tmpl` via the `.Mempool` template data field.
- **Location:** `cmd/dcrdata/views/mempool.tmpl`
  - **Data Structures:** `.Mempool.CoinFills`, `.Mempool.CoinStats`, `.Mempool.Transactions`
  - **Transformations:** Displays high-level mempool counts and loops through txs.

### Section 4 — Cross-Layer Dependencies
- `explorerroutes.go` directly depends on `exp.MempoolInventory()` avoiding data races using a read lock (`inv.RLock()`).
- The UI (websockets and templates) relies on the `MempoolCoinStats.Amount` string being formatted directly instead of parsed as a `float64` to avoid precision loss.

### Section 5 — Critical Constraints
- **Precision rules:** SKA amounts use 18 decimals and are manipulated via `big.Int`. VAR uses 8 decimals. `addAtomStrings` with `isBig=true` MUST be used for SKA arithmetic.
- **Data Trimming:** `TrimMempoolTx` currently discards `tx.SKATotals`. For individual SKA transactions to be accurately displayed in the mempool list, `TrimmedTxInfo` must be extended to preserve SKA amounts.

### Section 6 — Mutation Impact
When modifying SKA data in mempool, check:
- **Direct dependencies:** `mempool/monitor.go` (amount aggregation), `explorer/explorer.go` (`StoreMPData` metrics extraction).
- **Indirect dependencies:** `mempool.tmpl` (must render strings correctly), `TrimmedTxInfo` (needs to propagate `SKATotals`).
- **Silent failures:** Coercing `MempoolCoinStats.Amount` or `SKATotals` to `float64` will cause silent precision loss.
- **Hard failures:** Adding keys to `CoinStats` map concurrently without write locks.

### Section 7 — Common Pitfalls
- Storing SKA totals as `int64` or `float64` instead of `big.Int` or `string` in mempool aggregates.
- Forgetting to pass the `isBig=true` flag for SKA transactions in `addAtomStrings`.
- Not exposing `SKATotals` in `TrimmedTxInfo`, meaning the `mempool.tmpl` `range .Transactions` loop cannot render SKA transaction amounts.

### Section 8 — Evidence
- `mempool/monitor.go:374` — `s.Amount = addAtomStrings(s.Amount, amtStr, true)`
- `explorer/types/explorertypes.go:859` — `TrimMempoolTx` creates a `TrimmedTxInfo` without mapping `SKATotals`.
