package txhelpers

import (
	"fmt"
	"math/big"

	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/wire"
)

// pre-computed constants to avoid repeated allocations.
var (
	ssfeeVarScale = new(big.Int).Exp(big.NewInt(10), big.NewInt(8), nil)  // 1e8
	ssfeeDp       = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil) // 1e18
)

// SSFeeSummary holds the per-block data needed to compute average SKA/VAR rates.
type SSFeeSummary struct {
	SSFeeTotalsByCoin map[uint8]string
	StakeDiff         float64 // ticket price in VAR coins
}

// BlockSSFeeTotals sums TxTypeSSFee output SKAValues per coin type for a block.
// Returns nil if no SSFee transactions are present.
func BlockSSFeeTotals(msgBlock *wire.MsgBlock) map[uint8]string {
	totals := make(map[uint8]*big.Int)
	for _, tx := range msgBlock.STransactions {
		if stake.DetermineTxType(tx) != stake.TxTypeSSFee {
			continue
		}

		var inputSKA, outputSKA big.Int
		var coinType uint8

		// Sum all SKA inputs
		for _, vin := range tx.TxIn {
			if vin.SKAValueIn != nil {
				inputSKA.Add(&inputSKA, vin.SKAValueIn)
			}
		}

		// Sum all SKA outputs and track coin type
		for _, out := range tx.TxOut {
			if out.CoinType.IsSKA() && out.SKAValue != nil {
				outputSKA.Add(&outputSKA, out.SKAValue)
				if coinType == 0 {
					coinType = uint8(out.CoinType)
				}
			}
		}

		// Calculate actual reward: output - input (positive = to voters)
		if coinType != 0 && outputSKA.Sign() > 0 && inputSKA.Sign() > 0 {
			reward := new(big.Int).Sub(&outputSKA, &inputSKA)
			if reward.Sign() > 0 {
				if totals[coinType] == nil {
					totals[coinType] = new(big.Int)
				}
				totals[coinType].Add(totals[coinType], reward)
			}
		}
	}
	if len(totals) == 0 {
		return nil
	}
	result := make(map[uint8]string, len(totals))
	for ct, v := range totals {
		result[ct] = v.String()
	}
	return result
}

// FormatSKAAtoms converts SKA atoms (1e18) to a fixed-point decimal string with 18 decimal places.
func FormatSKAAtoms(skaAtoms *big.Int) string {
	if skaAtoms == nil || skaAtoms.Sign() <= 0 {
		return "0.000000000000000000"
	}
	intPart, fracPart := new(big.Int).DivMod(skaAtoms, ssfeeDp, new(big.Int))
	return fmt.Sprintf("%s.%018d", intPart.String(), fracPart.Int64())
}

// FormatSKAPerVAR computes (skaAtoms/1e18) / (varAtoms/1e8) — SKA coins per
// VAR coin — and returns a fixed-point decimal string with 18 decimal places.
func FormatSKAPerVAR(skaAtoms *big.Int, varAtoms int64) string {
	if varAtoms <= 0 || skaAtoms == nil || skaAtoms.Sign() <= 0 {
		return "0.000000000000000000"
	}
	resultScaled := new(big.Int).Mul(skaAtoms, ssfeeVarScale)
	resultScaled.Div(resultScaled, big.NewInt(varAtoms))
	intPart, fracPart := new(big.Int).DivMod(resultScaled, ssfeeDp, new(big.Int))
	return fmt.Sprintf("%s.%018d", intPart.String(), fracPart.Int64())
}

// SSFeeCoinTypes returns the set of unique SKA coin types that appear in any
// of the provided block summaries.
func SSFeeCoinTypes(summaries []SSFeeSummary) map[uint8]struct{} {
	out := make(map[uint8]struct{})
	for _, s := range summaries {
		for ct := range s.SSFeeTotalsByCoin {
			out[ct] = struct{}{}
		}
	}
	return out
}

// AvgSSFeeRate returns the average SKA/VAR staker reward rate over the provided
// block summaries for the given coin type and voter count per block.
func AvgSSFeeRate(summaries []SSFeeSummary, coinType uint8, ticketsPerBlock uint16) string {
	total := new(big.Int)
	var count int
	voters := int64(ticketsPerBlock)
	for _, s := range summaries {
		if s.SSFeeTotalsByCoin == nil {
			continue
		}
		v, ok := s.SSFeeTotalsByCoin[coinType]
		if !ok {
			continue
		}
		amt, ok := new(big.Int).SetString(v, 10)
		if !ok {
			continue
		}
		ticketPriceAtoms := int64(s.StakeDiff * 1e8)
		if ticketPriceAtoms <= 0 {
			continue
		}
		perVote := new(big.Int).Div(amt, big.NewInt(voters))
		rs := new(big.Int).Mul(perVote, ssfeeVarScale)
		ratio := new(big.Int).Div(rs, big.NewInt(ticketPriceAtoms))
		total.Add(total, ratio)
		count++
	}
	if count == 0 {
		return "0.000000000000000000"
	}
	avg := new(big.Int).Div(total, big.NewInt(int64(count)))
	intPart, fracPart := new(big.Int).DivMod(avg, ssfeeDp, new(big.Int))
	return fmt.Sprintf("%s.%018d", intPart.String(), fracPart.Int64())
}
