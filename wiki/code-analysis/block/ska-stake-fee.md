# SKA Stake Fee showed 0 in "Stake Fees" table

## Status

**FIXED** on `fix/ska-stake-fee-display` (commits `4a85e74`, `18e27af`, closes #301).

- `db/dcrpg/pgblockchain.go` — SSFee `FeeRaw` computed as `Σoutputs − Σinputs` (net reward, matching `BlockSSFeeTotals` in `txhelpers/ssfee.go`).
- `cmd/dcrdata/views/block.tmpl` — column header renamed from "Fee" to "Rewards".
- Coin type now determined by scanning for the first SKA payout output instead of trusting `TxOut[0]` (which may be a zero-value OP_RETURN marker).

## Problem

The **Stake Fees** table on `/block/{hash}` displayed `0` for the value column of every SKA stake-fee (SSFee) transaction. Expected: the correct distribution amount (e.g. `5.0 SKA1`). The column is now named **"Rewards"** to match the semantic — SSFee transactions distribute rewards, they don't pay fees.

This is **Defect 3** from the block fee audit. Defects 1 (header scope) and 2 (SKA fee rate) were fixed on `fix/block-fees-pagination-ska`.

## Reproduction

1. Load any block that contains SSFee transactions for an SKA coin type.
2. Scroll to the "Stake Fees" table.
3. Observe a value of `0` for every SKA entry.

## Root cause

All transactions (regular + stake) go through `trimmedTxInfoFromMsgTx` in `db/dcrpg/pgblockchain.go`. The SKA fee is computed at line 6569 as:

```go
fee := new(big.Int).Sub(totalIn, totalOut)
```

This is the correct direction for **regular SKA transactions** — the sender pays `totalIn - totalOut`. But SSFee (stake fee distribution) transactions have a fundamentally different structure:

- **Input**: null/zero (`SKAAmountIn` is empty → `totalIn = 0`)
- **Outputs**: the fee amounts being distributed (e.g. mining reward, staking reward)

The arithmetic becomes `0 - positive = negative`, clamped to `"0"` by the sign guard at line 6570-6572:

```go
if fee.Sign() < 0 {
    fee.SetInt64(0)
}
```

The correct arithmetic for SSFee is the **reverse**: `totalOut - totalIn` (the miner/staker earns the fee). This is consistent with how `BlockSSFeeTotals` in `txhelpers/ssfee.go` already computes the per-coin-type net fee for the header display.

## Code path trace (after fix)

```
GetExplorerBlock (pgblockchain.go:6608)
  └─ for each msgTx in data.RawSTx:
       └─ trimmedTxInfoFromMsgTx → returns stx with FeeRaw="0" (clamped)
       └─ switch txType {
            case stake.TxTypeSSFee:
              // Determine coin type by scanning for first SKA payout output
              // (TxOut[0] may be a zero-value OP_RETURN marker with CoinType 0)
              for _, out := range msgTx.TxOut {
                  if out.CoinType.IsSKA() && out.SKAValue != nil {
                      stx.CoinType = uint8(out.CoinType)
                      break
                  }
              }
              // Compute net = Σoutputs − Σinputs (matching BlockSSFeeTotals)
              net := new(big.Int)
              for _, vin := range msgTx.TxIn {
                  if vin.SKAValueIn != nil { net.Sub(net, vin.SKAValueIn) }
                  else                     { net.Sub(net, big.NewInt(vin.ValueIn)) }
              }
              for _, out := range msgTx.TxOut {
                  if out.CoinType.IsSKA() && out.SKAValue != nil { net.Add(net, out.SKAValue) }
                  else                                           { net.Add(net, big.NewInt(out.Value)) }
              }
              stx.FeeRaw = net.String()
              stakeFees = append(stakeFees, stx)
          }
  └─ block.StakeFees = stakeFees

Template (block.tmpl:373-374)
  └─ range .StakeFees
       └─ coinDecimalParts .FeeRaw .CoinType → now shows correct positive value
       └─ column header: "Rewards" instead of "Fee"
```

Note that the **header** `FeesByCoin` for SKA was **already correct** because it's derived from `SSFeeTotalsByCoin` (via `BlockSSFeeTotals` in `txhelpers/ssfee.go`), not from `StakeFees[].FeeRaw`. Only the per-transaction column in the table was wrong.

## Fix applied

The fix overrides `FeeRaw` in the `case stake.TxTypeSSFee:` handler inside `GetExplorerBlock`, after the coin type override. It computes the net reward as `Σoutputs − Σinputs`, matching the `BlockSSFeeTotals` calculation:

```go
case stake.TxTypeSSFee:
    if len(msgTx.TxOut) > 0 {
        // Determine coin type from the first SKA payout output.
        // TxOut[0] may be a zero-value OP_RETURN marker (CoinType 0).
        for _, out := range msgTx.TxOut {
            if out.CoinType.IsSKA() && out.SKAValue != nil {
                stx.CoinType = uint8(out.CoinType)
                break
            }
        }
        // SSFee is a distribution tx — the "reward" is the net
        // value (totalOutput − totalInput), matching BlockSSFeeTotals.
        net := new(big.Int)
        for _, vin := range msgTx.TxIn {
            if vin.SKAValueIn != nil {
                net.Sub(net, vin.SKAValueIn)
            } else {
                net.Sub(net, big.NewInt(vin.ValueIn))
            }
        }
        for _, out := range msgTx.TxOut {
            if out.CoinType.IsSKA() && out.SKAValue != nil {
                net.Add(net, out.SKAValue)
            } else {
                net.Add(net, big.NewInt(out.Value))
            }
        }
        stx.FeeRaw = net.String()
    }
    stakeFees = append(stakeFees, stx)
```

**Why this approach:**
- Scoped to the SSFee case only — no risk of breaking regular SKA tx fee calculation in `trimmedTxInfoFromMsgTx`.
- Coin type determination scans outputs instead of trusting `TxOut[0]` — handles OP_RETURN markers correctly.
- Net calculation matches `BlockSSFeeTotals` — correct for both null-input and consolidation SSFee txs.
- Column renamed to **"Rewards"** — SSFee transactions are fee distributions, not fee payments. This also avoids the negative-number display problem that `skaDecimalParts` would have with negative atom strings.
- Also fixes VAR SSFee entries which showed negative fees through the `TxFeeRate` path.

## Testing

A test case in `pgblockchain_internal_test.go` should be added that:

1. Constructs an SSFee `MsgTx` with a null input and a distribution output (`SKAValue = 5 SKA1`).
2. Calls `trimmedTxInfoFromMsgTx`.
3. Asserts `FeeRaw` equals the expected atom string (e.g. `"5000000000000000000"` for 5 SKA1).

The existing `TestTrimmedTxInfoFromMsgTx` fixture pattern can be extended.
