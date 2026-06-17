# SKA Stake Fee showed 0 in "Stake Fees" table

## Status

**FIXED** on `fix/ska-stake-fee-display` (commits `4a85e74`, `18e27af`, closes #301).

- `db/dcrpg/pgblockchain.go` — SSFee `FeeRaw` computed as `Σoutputs − Σinputs` (net reward, matching `BlockSSFeeTotals` in `txhelpers/ssfee.go`).
- `cmd/dcrdata/views/block.tmpl` — column header renamed from "Fee" to "Rewards".
- Coin type now determined by scanning for the first SKA payout output instead of trusting `TxOut[0]` (which may be a zero-value OP_RETURN marker).

> **Update (2026-06): the tx-detail page was the same defect's second surface.**
> The fix above covered the **block** page (`GetExplorerBlock` + `block.tmpl`). The **transaction-detail** page (`GetExplorerTx` + the `tx.tmpl` header) had the identical bug — it showed the negated fee via `TxFeeRate` (sign dropped by the formatter for sub-1 VAR) and clamped the SKA path to `0` — and was fixed only later by **PR #485** (header "Fee"→"Fee Reward" for SSFee) and **PR #486** (value via `ssFeeNetReward` + `coinDecimalParts`), both **merged**. The two surfaces now share `ssFeeNetReward`. Lesson: a fix scoped to one render surface (block) does not cover the others (tx-detail); grep for sibling surfaces.
>
> **SKA is dormant.** SKA staking / SKA fee-distribution is **not a planned feature** — there are **0** SKA SSFee txs on testnet3 and mainnet (see [staking-rewards §3](../../core/staking-rewards.md)). The SKA branch here (and in #486) is defensive; the only Stake-Fee case that actually occurs is **VAR** SSFee, for which #486's live value is consistency with this page (no reliance on the formatter sign-drop) rather than a user-visible bug fix.

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

Extracted as a package-level helper `ssFeeNetReward` in `pgblockchain.go` and tested in `pgblockchain_internal_test.go` (`TestSSFeeNetReward`). Four table-driven cases:

| Case | Input | Output | Expected net |
|------|-------|--------|-------------|
| Null input SKA | `ValueIn=0, SKAValueIn=nil` | `SKAValue=5e18` | `5e18` |
| Consolidation SKA | `SKAValueIn=1e18` | `SKAValue=2e18` | `1e18` |
| Null input VAR | `ValueIn=0` | `Value=100000000` | `100000000` |
| Zero reward | `SKAValueIn=5e18` | `SKAValue=5e18` | `0` |

The helper's per-element `SKAValueIn`/`SKAValue` branching rather than a prior `isSKA` gate matches the same result given the single-coin-per-tx invariant, and the comment calls out the equivalence.

---

## Follow-up: header fee halving, fee-rate unit, and a TxType column

Three further defects on the same `/block/{hash}` Stake Fees table and block header
were fixed on `fix/block-fee-header-sfa` (commit `839175fa`, with a fee-rate
adjustment in `780ffc35` and styling in `856f4be4`/`53647112`).

### 1. VAR fee pool was halved in the block header (`FeesByCoin`)

The header `FeesByCoin` is assembled in `GetExplorerBlock` from a `feesMap`:
VAR (`ct==0`) is sourced from `block.MiningFee` (the full block fee pool), then SKA
coin types are added from `SSFeeTotalsByCoin` (`skaFeeTotals`). The SKA loop
iterated **all** coin types, including `ct==0`, so VAR's full fee pool was
overwritten by `split.PoW + split.PoS` — only the staker's 50% share — halving the
displayed VAR fee.

Fix: `continue` on `ct==0` inside the `skaFeeTotals` loop, leaving VAR sourced
exclusively from `MiningFee`.

```go
// db/dcrpg/pgblockchain.go — GetExplorerBlock
for ct, split := range skaFeeTotals {
    if ct == 0 {
        continue // VAR already sourced from MiningFee above; don't overwrite with the 50% staker share
    }
    ...
}
```

This is a **header** correctness fix, distinct from the per-tx `FeeRaw` fix above:
the per-tx "Rewards" column was already correct, but the aggregate VAR fee in the
block header was wrong.

### 2. SKA fee-rate unit: atoms/kB → atoms/B (`SKA<n>/B`)

The fee-rate value travels on the wire as **atoms/kB**. For VAR that is rendered
directly as `VAR/kB`. For SKA the 18-decimal atoms/kB number is too small per kB to
be legible, so the SKA path now divides by 1000 (integer `big.Int` division) and
renders as `SKA<n>/B`.

- `coinFeeRateDecimalParts` (SKA branch) wraps the value in a new
  `skaAtomsPerKBToPerByte` helper before `skaDecimalParts`. Sub-atom-per-byte
  remainder is unrepresentable and dropped; empty/non-numeric input passes through
  unchanged for the safe `["0","",""]` fallback.
- `coinFeeRateUnit` returns `VAR/kB` for VAR and `<symbol>/B` for SKA.

Note: a separate SKA-fee-rate unit revision (`SKA<n>/kB`) was in flight by another
team member; `780ffc35` deliberately restored the `/1000` + `/B` behaviour here so
the two efforts don't collide. Treat the `/B` unit as the current code state, not a
settled decision.

### 3. SF/MF marker exposed as a TxType column

Each SSFee transaction carries an SSFee marker in an output `pkScript` indicating
whether it is the **staker** payout (`SF`) or the **miner** payout (`MF`) — the same
SF/MF split described in [staking-rewards](../../core/staking-rewards.md) §3.2.

- `explorer/types/explorertypes.go`: `TrimmedTxInfo` gains
  `SSFeeMarker string` (`"SF"`/`"MF"`, json `ssfee_marker,omitempty`).
- `GetExplorerBlock` (SSFee case): scans `msgTx.TxOut` with
  `stake.HasSSFeeMarker(out.PkScript)`, mapping `SSFeeMarkerStaker`→`"SF"` and
  `SSFeeMarkerMiner`→`"MF"`. If no marker is found (should never happen for a valid
  SSFee tx) it logs a warning and defaults to `"SF"` as the safer assumption.
- `cmd/dcrdata/views/block.tmpl`: the Stake Fees table gains a trailing **TxType**
  column rendering `{{.SSFeeMarker}}` (`mono fs15 text-end`, matching the Size
  column).

