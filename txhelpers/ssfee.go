package txhelpers

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/cointype"
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

	// 1. Calculate VAR fees from SSGen transactions
	// Total PoS Reward = Sum of all SSGen reward outputs.
	// Total VAR Fee = Total PoS Reward - 16 VAR subsidy.
	var totalVARReward int64
	var ssGenFound bool
	for _, tx := range msgBlock.STransactions {
		if stake.DetermineTxType(tx) == stake.TxTypeSSGen {
			ssGenFound = true
			for _, out := range tx.TxOut {
				if out.CoinType == cointype.CoinTypeVAR {
					totalVARReward += out.Value
				}
			}
		}
	}
	if ssGenFound {
		const totalPoSSubsidy = 16 * 1e8
		feeVAR := totalVARReward - totalPoSSubsidy
		if feeVAR > 0 {
			totals[uint8(cointype.CoinTypeVAR)] = big.NewInt(feeVAR)
		}
	}

	// 2. Calculate SKA fees from TxTypeSSFee transactions
	for _, tx := range msgBlock.STransactions {
		if stake.DetermineTxType(tx) != stake.TxTypeSSFee {
			continue
		}

		var inputTotal, outputTotal big.Int
		var coinType uint8

		// Sum all inputs for the primary coin type of this fee transaction
		for _, vin := range tx.TxIn {
			if vin.SKAValueIn != nil {
				inputTotal.Add(&inputTotal, vin.SKAValueIn)
			}
		}

		// Sum all outputs
		for _, out := range tx.TxOut {
			if out.CoinType.IsSKA() && out.SKAValue != nil {
				outputTotal.Add(&outputTotal, out.SKAValue)
				if coinType == 0 {
					coinType = uint8(out.CoinType)
				}
			}
		}

		// Calculate actual reward: output - input
		if coinType != 0 {
			reward := new(big.Int).Sub(&outputTotal, &inputTotal)
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
		return "0.000000000000000000"
	}

	avgAPY := sumAPY / float64(count)
	return fmt.Sprintf("%.18f", avgAPY)
}
