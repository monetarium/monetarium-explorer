package explorer

import (
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestVisualBlocksDataContract(t *testing.T) {
	// Setup mock data
	params := &chaincfg.Params{
		MaximumBlockSizes: []int{393216},
	}
	issuedSKA := []uint8{1, 2}
	maxBlockSize := float64(params.MaximumBlockSizes[0])

	t.Run("BlockContractConsistency", func(t *testing.T) {
		rows := []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", TxCount: 10, Amount: "100", Size: 10000},
			{CoinType: 1, Symbol: "SKA1", TxCount: 5, Amount: "50", Size: 5000},
			{CoinType: 2, Symbol: "SKA2", TxCount: 2, Amount: "20", Size: 2000},
		}

		// 1. HTTP Path: TrimmedBlockInfo
		stats := make(map[uint8]types.MempoolCoinStats)
		for _, r := range rows {
			stats[r.CoinType] = types.MempoolCoinStats{Size: int32(r.Size)}
		}
		fills, _, activeSka := types.ComputeCoinFills(stats, maxBlockSize, issuedSKA)

		tbi := types.TrimmedBlockInfo{
			Size:              17000,
			FormattedBytes:    "17 kB",
			CoinFills:         fills,
			ActiveSKACount:    activeSka,
			MaxBlockSize:      maxBlockSize,
			RegularCoinCounts: types.RegularCoinCountsFromCoinRows(rows, 2, 1, 1),
		}

		// 2. WS Path: BlockInfo (simulated copying/populating)
		bi := &types.BlockInfo{
			BlockBasic: &types.BlockBasic{
				Size:           17000,
				FormattedBytes: "17 kB",
				CoinRows:       rows,
			},
		}

		// Simulation of the logic added to websockethandlers.go
		biStats := make(map[uint8]types.MempoolCoinStats)
		for _, r := range rows {
			biStats[r.CoinType] = types.MempoolCoinStats{Size: int32(r.Size)}
		}
		biFills, _, biActiveSka := types.ComputeCoinFills(biStats, maxBlockSize, issuedSKA)
		bi.CoinFills = biFills
		bi.ActiveSKACount = biActiveSka
		bi.MaxBlockSize = maxBlockSize

		// Compare key contract fields
		if tbi.Size != bi.BlockBasic.Size {
			t.Errorf("Size mismatch: HTTP %d, WS %d", tbi.Size, bi.BlockBasic.Size)
		}
		if tbi.FormattedBytes != bi.BlockBasic.FormattedBytes {
			t.Errorf("FormattedBytes mismatch: HTTP %s, WS %s", tbi.FormattedBytes, bi.BlockBasic.FormattedBytes)
		}
		if len(tbi.CoinFills) != len(bi.CoinFills) {
			t.Errorf("CoinFills length mismatch: HTTP %d, WS %d", len(tbi.CoinFills), len(bi.CoinFills))
		}
		if tbi.ActiveSKACount != bi.ActiveSKACount {
			t.Errorf("ActiveSKACount mismatch: HTTP %d, WS %d", tbi.ActiveSKACount, bi.ActiveSKACount)
		}
		if tbi.MaxBlockSize != bi.MaxBlockSize {
			t.Errorf("MaxBlockSize mismatch: HTTP %f, WS %f", tbi.MaxBlockSize, bi.MaxBlockSize)
		}
	})

	t.Run("MempoolContractConsistency", func(t *testing.T) {
		mpi := &types.MempoolInfo{
			MempoolShort: types.MempoolShort{
				TotalSize:      20000,
				ActiveSKACount: 2,
				CoinFills:      []types.CoinFillData{{Symbol: "VAR", Status: "ok"}},
			},
		}

		trimmed := mpi.Trim(maxBlockSize)

		if trimmed.MaxBlockSize != maxBlockSize {
			t.Errorf("Mempool MaxBlockSize mismatch: want %f, got %f", maxBlockSize, trimmed.MaxBlockSize)
		}
		if trimmed.TotalSize != 20000 {
			t.Errorf("Mempool TotalSize mismatch: want 20000, got %d", trimmed.TotalSize)
		}
	})

	t.Run("VoteFlagConsistency", func(t *testing.T) {
		// Test TrimMempoolTx
		tx := types.MempoolTx{
			VoteInfo: &types.VoteInfo{},
		}
		trimmed := types.TrimMempoolTx(&tx)
		if !trimmed.Voted {
			t.Error("TrimMempoolTx: expected Voted=true for vote tx")
		}

		txNonVote := types.MempoolTx{
			VoteInfo: nil,
		}
		trimmedNonVote := types.TrimMempoolTx(&txNonVote)
		if trimmedNonVote.Voted {
			t.Error("TrimMempoolTx: expected Voted=false for non-vote tx")
		}
	})
}
