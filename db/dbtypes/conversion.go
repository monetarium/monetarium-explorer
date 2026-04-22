package dbtypes

import (
	"fmt"
	"math"
	"math/big"

	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/wire"

	"github.com/monetarium/monetarium-explorer/txhelpers"
)

// blockCoinAmounts sums TxOut values per coin type across all transactions in
// the block. VAR (key 0) is stored as a decimal int64 string; SKAn as a
// big.Int decimal string.
func blockCoinAmounts(msgBlock *wire.MsgBlock) map[uint8]string {
	varTotal := int64(0)
	skaTotal := make(map[uint8]*big.Int)
	allTxs := append(msgBlock.Transactions, msgBlock.STransactions...)
	for _, tx := range allTxs {
		for _, out := range tx.TxOut {
			ct := out.CoinType
			if ct == cointype.CoinTypeVAR {
				varTotal += out.Value
			} else if ct.IsSKA() && out.SKAValue != nil {
				k := uint8(ct)
				if skaTotal[k] == nil {
					skaTotal[k] = new(big.Int)
				}
				skaTotal[k].Add(skaTotal[k], out.SKAValue)
			}
		}
	}
	if varTotal == 0 && len(skaTotal) == 0 {
		return nil
	}
	result := make(map[uint8]string, 1+len(skaTotal))
	result[uint8(cointype.CoinTypeVAR)] = fmt.Sprintf("%d", varTotal)
	for k, v := range skaTotal {
		result[k] = v.String()
	}
	return result
}

// blockCoinTxStats returns per-coin tx count and total serialized size for all
// transactions in a block (key 0=VAR, 1-255=SKAn). Returns nil for empty blocks.
func blockCoinTxStats(msgBlock *wire.MsgBlock) map[uint8]CoinTxStats {
	stats := make(map[uint8]CoinTxStats)
	allTxs := append(msgBlock.Transactions, msgBlock.STransactions...)
	for _, tx := range allTxs {
		ct := uint8(cointype.CoinTypeVAR)
		for _, out := range tx.TxOut {
			if out.CoinType.IsSKA() {
				ct = uint8(out.CoinType)
				break
			}
		}
		s := stats[ct]
		s.TxCount++
		s.Size += uint32(tx.SerializeSize())
		stats[ct] = s
	}
	if len(stats) == 0 {
		return nil
	}
	return stats
}

// MsgBlockToDBBlock creates a dbtypes.Block from a wire.MsgBlock
func MsgBlockToDBBlock(msgBlock *wire.MsgBlock, chainParams *chaincfg.Params, chainWork string, winners []ChainHash) *Block {
	// Create the dbtypes.Block structure
	blockHeader := msgBlock.Header

	// Assemble the block
	return &Block{
		Hash:    ChainHash(blockHeader.BlockHash()),
		Size:    uint32(msgBlock.SerializeSize()),
		Height:  blockHeader.Height,
		Version: uint32(blockHeader.Version),
		NumTx:   uint32(len(msgBlock.Transactions) + len(msgBlock.STransactions)),
		// nil []int64 for TxDbIDs
		NumRegTx:          uint32(len(msgBlock.Transactions)),
		NumStakeTx:        uint32(len(msgBlock.STransactions)),
		Time:              NewTimeDef(blockHeader.Timestamp),
		Nonce:             uint64(blockHeader.Nonce),
		VoteBits:          blockHeader.VoteBits,
		Voters:            blockHeader.Voters,
		FreshStake:        blockHeader.FreshStake,
		Revocations:       blockHeader.Revocations,
		PoolSize:          blockHeader.PoolSize,
		Bits:              blockHeader.Bits,
		SBits:             uint64(blockHeader.SBits),
		Difficulty:        txhelpers.GetDifficultyRatio(blockHeader.Bits, chainParams),
		StakeVersion:      blockHeader.StakeVersion,
		PreviousHash:      ChainHash(blockHeader.PrevBlock),
		ChainWork:         chainWork,
		Winners:           winners,
		CoinAmounts:       blockCoinAmounts(msgBlock),
		CoinTxStats:       blockCoinTxStats(msgBlock),
		SSFeeTotalsByCoin: txhelpers.BlockSSFeeTotals(msgBlock),
	}
}

// TimeBasedGroupingToInterval converts the TimeBasedGrouping value to an actual
// time value in seconds based on the gregorian calendar except AllGrouping that
// returns 1 while the unknownGrouping returns -1 and an error.
func TimeBasedGroupingToInterval(grouping TimeBasedGrouping) (float64, error) {
	var hr = 3600.0
	// days per month value is obtained by 365/12
	var daysPerMonth = 30.416666666666668
	switch grouping {
	case AllGrouping:
		return 1, nil

	case DayGrouping:
		return hr * 24, nil

	case WeekGrouping:
		return hr * 24 * 7, nil

	case MonthGrouping:
		return hr * 24 * daysPerMonth, nil

	case YearGrouping:
		return hr * 24 * daysPerMonth * 12, nil

	default:
		return -1, fmt.Errorf(`unknown grouping "%d"`, grouping)
	}
}

// CalculateHashRate calculates the hashrate from the difficulty value and
// the targetTimePerBlock in seconds. The hashrate returned is in form PetaHash
// per second (PH/s).
func CalculateHashRate(difficulty, targetTimePerBlock float64) float64 {
	return ((difficulty * math.Pow(2, 32)) / targetTimePerBlock) / 1000000
}

// CalculateWindowIndex calculates the window index from the quotient of a block
// height and the chainParams.StakeDiffWindowSize.
func CalculateWindowIndex(height, stakeDiffWindowSize int64) int64 {
	// A window being a group of blocks whose count is defined by
	// chainParams.StakeDiffWindowSize, the first window starts from block 1 to
	// block 144 instead of block 0 to block 143. To obtain the accurate window
	// index value, we should add 1 to the quotient obtained by dividing the block
	// height with the chainParams.StakeDiffWindowSize value; if the float precision
	// is greater than zero. The precision is equal to zero only when the block
	// height value is divisible by the window size.
	windowVal := float64(height) / float64(stakeDiffWindowSize)
	index := int64(windowVal)
	if windowVal != math.Floor(windowVal) || windowVal == 0 {
		index++
	}
	return index
}
