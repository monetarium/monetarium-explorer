- **One-line Flow:**
  Mempool txs are decoded in Go (`txhelpers`) into a single coin total (`MempoolTx.SKATotals`); confirmed txs proxy Node RPC (`GetRawTransactionVerbose`) verbatim into array slices (`TxShort.Vout[]`); SSFee txs additionally trigger `ssFeeNetReward()` to populate `FeeRaw` with a net reward (Σout − Σin, ≥ 0).
- **Key Architectural Patterns:**
  1. **Structural Bifurcation:** Mempool = struct maps at root level; Confirmed APIs = property-injected array slices.
  2. **`FeeRaw` semantic overload:** For SSFee txs `FeeRaw` = net reward (outputs − inputs, ≥ 0); for regular txs `FeeRaw` = fee (inputs − outputs, ≥ 0). Same field, opposite sign convention. Template MUST branch on `IsSSFee()` before rendering.
  3. **Dual ssFeeNetReward implementations:** `pgblockchain.go:ssFeeNetReward` mirrors `txhelpers/ssfee.go:blockSSFeeTotalsInternal` — two independent implementations, must stay in sync manually.
  4. **TicketStage classification:** Mempool ticket purchases are "Ready"/"Staging" based on whether vin parents are confirmed; both `collector.go` and `monitor.go` set it via `ticketStage()`.
- **Critical Constraints:**
  - `FeeReward()` on `TxInfo` is VAR-only float64 (coinbase/vote). Returns 0 defensively for `CoinType != 0` (SKA guard at `explorertypes.go:497`). SSFee uses `coinDecimalParts .FeeRaw .CoinType` (VAR or SKA big.Int). Never call `FeeReward()` for SKA display — it returns 0 silently.
  - SKA amounts must stay `*big.Int`/string end-to-end. `tx.tmpl` amount cells branch on `$.Data.CoinType 0` — VAR via `float64AsDecimalParts .Amount` (8-dec, float64-safe per C1), SKA via `skaDecimalParts .ValueRaw` (string). A new coin-dependent field must extend **both** branches.
  - `MiningFee` in block header = `Tx + Tickets` only (no votes/revocations/treasury). The SQL chart query `internal.SelectFeesPerBlockAboveHeight` must mirror this definition.
  - **`MempoolTx.Hash` removed** — `TxID` is canonical; JSON key is `"txid"`. Any consumer referencing `"hash"` receives `undefined`/empty.
  - **Tx type strings** — All `TxType*` string constants live in `txhelpers/txhelpers.go` (not `explorertypes.go`). `Is*()` methods on `TxInfo` compare against `txhelpers.TxTypeXxx`.
  - **`UnspentOutputIndices()`** — now SKA-safe: skips `vout.SKAValue == "" && vout.Amount == 0.0` (previously excluded all SKA vouts with `Amount == 0`).
- **Mutation Checklist:**
  - [ ] Does your change affect `FeeRaw`? — verify SSFee vs regular tx distinction is preserved
  - [ ] Did you update `apitypes.Vout` / `apitypes.TxShort` (Confirmed)?
  - [ ] Did you update `explorertypes.MempoolTx` (Unconfirmed)? — if adding fields, also update `DeepCopy()`
  - [ ] SSFee path: did you update BOTH `GetExplorerBlock` AND `GetExplorerTx`?
  - [ ] `ssFeeNetReward` change: did you mirror it in `txhelpers/ssfee.go:blockSSFeeTotalsInternal`?
  - [ ] Are changes reflected in `homepage_controller.js`? — uses `tx.txid`, not `tx.hash`
  - [ ] Are changes reflected in `cmd/dcrdata/views/tx.tmpl` (all four fee/reward branches)?
  - [ ] New tx-type string: add to `txhelpers/txhelpers.go` (not `explorertypes.go`)

See also:
- /wiki/code-analysis/address/flow.compact.md — the address page shares the same multi-coin `tx.tmpl` render idiom
