package txhelpers

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/wire"
)

// pre-computed constants to avoid repeated allocations.
var (
	ssfeeVarScale = new(big.Int).Exp(big.NewInt(10), big.NewInt(8), nil)  // 1e8
	ssfeeDp       = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil) // 1e18
)

// VoteVARRewardResult holds the computed empirical rewards for VAR voting.
type VoteVARRewardResult struct {
	PerBlock float64
	Subsidy  float64
	Fee      float64
	ROI      float64
}

// ComputeVoteVARReward calculates the empirical reward per vote and ROI for a given block.
// It uses a 30-day average for the fee to ensure UI stability.
func ComputeVoteVARReward(sum30 []BlockSummary, voteData []VoteTicketData, params *chaincfg.Params, voters int64) VoteVARRewardResult {
	var subsidyPerVote, feePerVote float64
	if voters > 0 {
		const totalPoSSubsidy = 16.0
		subsidyPerVote = totalPoSSubsidy / float64(voters)

		var totalFees30d, totalVoters30d float64
		for _, s := range sum30 {
			if fStr, ok := s.SSFeeTotalsByCoin[0]; ok && fStr != "" {
				if f, err := strconv.ParseInt(fStr, 10, 64); err == nil {
					totalFees30d += float64(f) / 1e8
				}
			}
			totalVoters30d += float64(s.Voters)
		}

		if totalVoters30d > 0 {
			feePerVote = totalFees30d / totalVoters30d
		}
	}

	totalRewardPerVote := subsidyPerVote + feePerVote
	var avgROI float64
	if voters > 0 {
		if len(voteData) > 0 {
			var sumROI float64
			var validTickets int
			blocksPerYear := float64(365 * 24 * time.Hour / params.TargetTimePerBlock)
			maturity := float64(params.CoinbaseMaturity)
			for _, vd := range voteData {
				price, err := strconv.ParseFloat(vd.TicketPrice, 64)
				if err == nil && price > 0 {
					age := float64(vd.VoteHeight-vd.PurchaseHeight) + maturity
					if age > 0 {
						annualReward := totalRewardPerVote * (blocksPerYear / age)
						roi := (annualReward / price) * 100
						sumROI += roi
						validTickets++
					}
				}
			}
			if validTickets > 0 {
				avgROI = sumROI / float64(validTickets)
			}
		}
	}

	return VoteVARRewardResult{
		PerBlock: totalRewardPerVote,
		Subsidy:  subsidyPerVote,
		Fee:      feePerVote,
		ROI:      avgROI,
	}
}

// BlockSummary is a minimal interface for block summary data.
type BlockSummary struct {
	SSFeeTotalsByCoin map[uint8]string
	Voters            uint16
	Hash              string
	Height            int
}

// VoteTicketData is a minimal interface for ticket voting data.
type VoteTicketData struct {
	TicketPrice    string
	VoteHeight     int
	PurchaseHeight int
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
func SSFeeCoinTypes(summaries []BlockSummary) map[uint8]struct{} {
	out := make(map[uint8]struct{})
	for _, s := range summaries {
		for ct := range s.SSFeeTotalsByCoin {
			out[ct] = struct{}{}
		}
	}
	return out
}

// CalculateAverageTicketAPY computes the average annual percentage yield for a set of tickets.
// It returns the average as a big.Int atom string (18dp).
func CalculateAverageTicketAPY(voteData []VoteTicketData, rewardPerTicket *big.Float, blocksPerYear *big.Float) string {
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
