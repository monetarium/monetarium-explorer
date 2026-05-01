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
// It returns the average as a big.Int atom string (18dp).
func CalculateAverageTicketAPY(voteData []VoteTicket, rewardPerTicket *big.Float, blocksPerYear *big.Float) string {
	if len(voteData) == 0 {
		return "0"
	}

	const prec = 256
	sumAPY := new(big.Float).SetPrec(prec)
	count := 0

	// Pre-allocate or use constants where possible
	zero := new(big.Float).SetPrec(prec).SetInt64(0)
	varAtomsScale := new(big.Float).SetPrec(prec).SetInt64(100_000_000)

	// Pre-allocate loop variables to reduce allocations
	price := new(big.Float).SetPrec(prec)
	ageBF := new(big.Float).SetPrec(prec)
	term := new(big.Float).SetPrec(prec)
	atoms := new(big.Int)

	for _, vd := range voteData {
		if !strings.Contains(vd.TicketPrice, ".") {
			// Atoms
			if _, ok := atoms.SetString(vd.TicketPrice, 10); !ok {
				continue
			}
			price.SetInt(atoms)
			price.Quo(price, varAtomsScale)
		} else {
			// Decimal string
			var err error
			var p *big.Float
			p, _, err = big.ParseFloat(vd.TicketPrice, 10, prec, big.ToNearestEven)
			if err != nil {
				continue
			}
			price.Set(p)
		}

		if price.Cmp(zero) <= 0 {
			continue
		}

		age := int64(vd.VoteHeight - vd.PurchaseHeight)
		if age <= 0 {
			continue
		}
		ageBF.SetInt64(age)

		// APY_i = (BlocksPerYear * (rewardPerTicket / ticketPrice)) / age
		// Ensure we use high precision for rewardPerTicket and blocksPerYear copies.
		term.Copy(rewardPerTicket)
		term.Quo(term, price)
		term.Mul(term, blocksPerYear)
		term.Quo(term, ageBF)

		sumAPY.Add(sumAPY, term)
		count++
	}

	if count == 0 {
		return "0"
	}

	// avgAPY = sumAPY / count
	countBF := new(big.Float).SetPrec(prec).SetInt64(int64(count))
	avgAPY := new(big.Float).SetPrec(prec).Quo(sumAPY, countBF)

	// Convert the APY ratio to SKA atoms (1e18) so the result is consistent
	// with PerBlock and can be consumed by formatAtomsAsCoinString in templates.
	scale := new(big.Float).SetPrec(prec).SetInt(ssfeeDp) // 1e18
	avgAPY.Mul(avgAPY, scale)

	atomsInt, _ := avgAPY.Int(nil)
	if atomsInt == nil || atomsInt.Sign() <= 0 {
		return "0"
	}
	return atomsInt.String()
}
