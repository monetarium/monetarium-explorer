# SKA Stake Fee shows 0 in "Stake Fees" table

## Problem

The **Stake Fees** table on `/block/{hash}` displays `0` for the Fee column of every SKA stake-fee (SSFee) transaction. Expected: the correct SKA fee distribution amount (e.g. `5.0 SKA1`).

This is **Defect 3** from the block fee audit — Defects 1 (header scope) and 2 (SKA fee rate) were fixed on `fix/block-fees-pagination-ska`.

## Reproduction

1. Load any block that contains SSFee transactions for an SKA coin type.
2. Scroll to the "Stake Fees" table.
3. Observe a Fee value of `0` for every SKA entry.

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

## Code path trace

```
GetExplorerBlock (pgblockchain.go:6608)
  └─ for each msgTx in data.RawSTx:
       └─ trimmedTxInfoFromMsgTx(tx, ticketPrice, msgTx, params)  (line 6707)
            └─ makeExplorerTxBasic → txBasic with FeeRaw="0" (SKA path)
            └─ big.Int arithmetic: fee = totalIn - totalOut  (WRONG for SSFee)
            └─ returns stx
       └─ switch txType {
            case stake.TxTypeSSFee: (line 6736)
              stx.CoinType = uint8(msgTx.TxOut[0].CoinType)
              stakeFees = append(stakeFees, stx)
          }
  └─ block.StakeFees = stakeFees  (line 6775)
  └─ block.FeesByCoin = ...  (line 6847, derived from SSFeeTotalsByCoin — CORRECT)

Template (block.tmpl:373-374)
  └─ range .StakeFees
       └─ coinDecimalParts .FeeRaw .CoinType → shows "0"
```

Note that the **header** `FeesByCoin` for SKA is **correct** because it's derived from `SSFeeTotalsByCoin` (via `BlockSSFeeTotals` in `txhelpers/ssfee.go`), not from `StakeFees[].FeeRaw`. Only the per-transaction column in the table is wrong.

## Fix approach: Option B (recommended)

Override the fee in the `case stake.TxTypeSSFee:` handler inside `GetExplorerBlock`, after determining the coin type. Compute the total output value directly from `msgTx.TxOut` and set `stx.FeeRaw`:

```go
case stake.TxTypeSSFee:
    if len(msgTx.TxOut) > 0 {
        stx.CoinType = uint8(msgTx.TxOut[0].CoinType)
        totalOut := new(big.Int)
        for _, out := range msgTx.TxOut {
            if out.SKAValue != nil {
                totalOut.Add(totalOut, out.SKAValue)
            }
        }
        stx.FeeRaw = totalOut.String()
    }
    stakeFees = append(stakeFees, stx)
```

**Why Option B:**
- Scoped to the SSFee case only — no risk of breaking regular SKA tx fee calculation in `trimmedTxInfoFromMsgTx`.
- SSFee is the only stake type that distributes SKA fees; votes (`TxTypeSSGen`), tickets (`TxTypeSStx`), and revocations (`TxTypeSSRtx`) do not carry SSFee distributions.
- VAR SSFee entries don't exist (VAR fees flow through coinbase), so the change only affects SKA.

**Why not Option A** (invert subtraction in `trimmedTxInfoFromMsgTx`):
- Would require threading txType into the fee calc block, touching shared logic.
- Higher risk of regressions for regular SKA txs.

## Testing

Add a test case to `pgblockchain_internal_test.go` (or a new test file) that:

1. Constructs an SSFee `MsgTx` with a null input and a distribution output (`SKAValue = 5 SKA1`).
2. Calls `trimmedTxInfoFromMsgTx`.
3. Asserts `FeeRaw` equals the expected atom string (e.g. `"5000000000000000000"` for 5 SKA1).

The existing `TestTrimmedTxInfoFromMsgTx` fixture pattern can be extended.
