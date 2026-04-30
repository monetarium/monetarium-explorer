package txhelpers

import (
	"fmt"
	"math/big"
	"strings"

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
	Hash              string
	Height            int
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

// FormatSKAAtoms converts SKA atoms (1e18) to an atom string (integer string).
func FormatSKAAtoms(skaAtoms *big.Int) string {
	if skaAtoms == nil || skaAtoms.Sign() <= 0 {
		return "0"
	}
	return skaAtoms.String()
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

// VoteTicket holds data for a single vote and its associated ticket purchase.
type VoteTicket struct {
	TicketPrice    string
	VoteHeight     int
	PurchaseHeight int
}

// CalculateAverageTicketAPY computes the average annual percentage yield for a set of tickets.
// It returns the average as a decimal string with 18 decimal places.
func CalculateAverageTicketAPY(voteData []VoteTicket, rewardPerTicket *big.Float, blocksPerYear float64) string {
	if len(voteData) == 0 {
		return "0.000000000000000000"
	}

	var sumAPY float64
	var count int

	for _, vd := range voteData {
		price := new(big.Float)
		if !strings.Contains(vd.TicketPrice, ".") {
			// Atoms
			atoms := new(big.Int)
			if _, ok := atoms.SetString(vd.TicketPrice, 10); !ok {
				continue
			}
			price.SetInt(atoms)
			price.Quo(price, big.NewFloat(1e8))
		} else {
			// Decimal string
			var err error
			price, _, err = big.ParseFloat(vd.TicketPrice, 10, 256, big.ToNearestEven)
			if err != nil {
				continue
			}
		}

		if price.Cmp(big.NewFloat(0)) <= 0 {
			continue
		}

		age := float64(vd.VoteHeight - vd.PurchaseHeight)
		if age <= 0 {
			continue
		}

		// APY_i = (BlocksPerYear * (rewardPerTicket / ticketPrice)) / age
		term := new(big.Float).Copy(rewardPerTicket)
		term.Quo(term, price)
		term.Mul(term, big.NewFloat(blocksPerYear))
		term.Quo(term, big.NewFloat(age))

		val, _ := term.Float64()
		sumAPY += val
		count++
	}

	if count == 0 {
		return "0"
	}

	avgAPY := sumAPY / float64(count)

	// Convert the APY ratio to SKA atoms (1e18) so the result is consistent
	// with PerBlock and can be consumed by formatAtomsAsCoinString in templates.
	atomsFloat := new(big.Float).SetPrec(128).SetFloat64(avgAPY)
	scale := new(big.Float).SetPrec(128).SetInt(ssfeeDp) // 1e18
	atomsFloat.Mul(atomsFloat, scale)

	atomsInt, _ := atomsFloat.Int(nil)
	if atomsInt == nil || atomsInt.Sign() <= 0 {
		return "0"
	}
	return atomsInt.String()
}
