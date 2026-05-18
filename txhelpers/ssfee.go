package txhelpers

import (
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/monetarium/monetarium-explorer/api/rewardtypes"
	"github.com/monetarium/monetarium-node/blockchain/stake"
	"github.com/monetarium/monetarium-node/chaincfg"
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
// It uses the provided latest block's VAR fee (already excluding subsidy and ticket prices).
func ComputeVoteVARReward(latestVarFee float64, voteData []VoteTicketData, params *chaincfg.Params, voters int64, subsidy float64) VoteVARRewardResult {
	var subsidyPerVote, feePerVote, actualTotalFees float64
	if voters > 0 {
		subsidyPerVote = subsidy / float64(voters)

		// latestVarFee is the isolated "SF"-marked SSFee VAR staker payout
		// (BlockSSFeeTotals[0].PoS, atoms→coin). It is no longer the lumped
		// SSGen/SSRtx/SSFee net, and is not capped at 0: SF staker payouts are
		// legitimate even when other (consolidation) movement would net ≤ 0.
		actualTotalFees = latestVarFee
		feePerVote = actualTotalFees / float64(voters)
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
	SSFeeTotalsByCoin map[uint8]rewardtypes.SSFeeSplit
	Voters            uint16
	Hash              string
	Height            int
}

// VoteTicketData is a minimal interface for ticket voting data.
type VoteTicketData struct {
	TicketHash     string
	TicketPrice    string
	VoteHeight     int
	PurchaseHeight int
}

// SumWinningTicketPrices calculates the total VAR value of tickets that won a block.
func SumWinningTicketPrices(allTickets []VoteTicketData, winners []string) float64 {
	if len(winners) == 0 {
		return 0
	}

	winnerMap := make(map[string]struct{}, len(winners))
	for _, w := range winners {
		winnerMap[strings.ToLower(w)] = struct{}{}
	}

	var total float64
	summedTickets := make(map[string]struct{}, len(allTickets))
	for _, td := range allTickets {
		hash := strings.ToLower(td.TicketHash)
		if _, isWinner := winnerMap[hash]; isWinner {
			if _, alreadySummed := summedTickets[hash]; !alreadySummed {
				price, err := strconv.ParseFloat(td.TicketPrice, 64)
				if err == nil {
					total += price
				}
				summedTickets[hash] = struct{}{}
			}
		}
	}
	return total
}

// BlockSSFeeTotals sums SSFee reward distribution per coin type for a block,
// splitting each into its PoW ("MF") and PoS ("SF") portions using the
// authoritative on-chain SSFee OP_RETURN marker.
//
// Classification is centralized here (not pushed onto callers) so the HTTP and
// WebSocket reward paths cannot drift. Both VAR (coin type 0) and SKA
// (1..255) staker fees are delivered via "SF" SSFee transactions; only the
// marked SSFee txs are counted — SSGen/SSRtx are subsidy/principal movement,
// not fees. Returns nil if the block has no SSFee transactions.
func BlockSSFeeTotals(sTxs []*wire.MsgTx) map[uint8]rewardtypes.SSFeeSplit {
	return blockSSFeeTotalsInternal(sTxs, stake.DetermineTxType)
}

func blockSSFeeTotalsInternal(sTxs []*wire.MsgTx, determineType func(*wire.MsgTx) stake.TxType) map[uint8]rewardtypes.SSFeeSplit {
	totals := make(map[uint8]*rewardtypes.SSFeeSplit)

	for _, tx := range sTxs {
		if determineType(tx) != stake.TxTypeSSFee {
			continue
		}
		if len(tx.TxOut) == 0 {
			continue
		}

		// Determine the coin type from the first real SKA payout output.
		// The zero-value OP_RETURN marker / consolidation outputs may default
		// to coin type 0 (VAR), so keying off tx.TxOut[0] is unreliable; this
		// mirrors the proven detection used before the split refactor. If no
		// SKA payout output is present the tx distributes VAR (ct stays 0).
		var ct uint8
		isSKA := false
		for _, out := range tx.TxOut {
			if out.CoinType.IsSKA() && out.SKAValue != nil {
				ct = uint8(out.CoinType)
				isSKA = true
				break
			}
		}

		// net = Σoutputs − input. Per node consensus (stake.CheckSSFee) an
		// SSFee tx has exactly one input — null (value 0) or a real
		// consolidation UTXO being augmented — so the net is the exact
		// post-CalcFeeSplitByCoinType amount the node already wrote into the
		// outputs. VAR amounts live in the int64 Value field; SKA amounts in
		// the big.Int SKAValue field.
		net := new(big.Int)
		if isSKA {
			for _, vin := range tx.TxIn {
				if vin.SKAValueIn != nil {
					net.Sub(net, vin.SKAValueIn)
				}
			}
			for _, out := range tx.TxOut {
				if out.SKAValue != nil {
					net.Add(net, out.SKAValue)
				}
			}
		} else {
			for _, vin := range tx.TxIn {
				net.Sub(net, big.NewInt(vin.ValueIn))
			}
			for _, out := range tx.TxOut {
				net.Add(net, big.NewInt(out.Value))
			}
		}

		// An SSFee tx carries exactly one marker — "SF" (staker/PoS) or "MF"
		// (miner/PoW), never both — in a single zero-value OP_RETURN output.
		// Attribute the net wholesale to that marker's side. Stop at the first
		// marker so a malformed multi-marker tx cannot double-count.
		marker := stake.SSFeeMarkerNone
		for _, out := range tx.TxOut {
			if m := stake.HasSSFeeMarker(out.PkScript); m != stake.SSFeeMarkerNone {
				marker = m
				break
			}
		}

		if totals[ct] == nil {
			totals[ct] = &rewardtypes.SSFeeSplit{}
		}
		switch marker {
		case stake.SSFeeMarkerStaker:
			if totals[ct].PoS == nil {
				totals[ct].PoS = big.NewInt(0)
			}
			totals[ct].PoS.Add(totals[ct].PoS, net)
		case stake.SSFeeMarkerMiner:
			if totals[ct].PoW == nil {
				totals[ct].PoW = big.NewInt(0)
			}
			totals[ct].PoW.Add(totals[ct].PoW, net)
		}
	}

	if len(totals) == 0 {
		return nil
	}

	result := make(map[uint8]rewardtypes.SSFeeSplit, len(totals))
	for ct, split := range totals {
		result[ct] = *split
	}
	return result
}

// RewardAtomsToCoins converts a reward in atoms (big.Int) to coins (float64)
// using the specified decimal precision. A nil amount yields 0. This is the
// single conversion used by both the HTTP and WebSocket reward paths so they
// cannot drift.
func RewardAtomsToCoins(atoms *big.Int, decimals int) float64 {
	if atoms == nil {
		return 0
	}
	f := new(big.Float).SetInt(atoms)
	div := new(big.Float).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil))
	f.Quo(f, div)
	res, _ := f.Float64()
	return res
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
