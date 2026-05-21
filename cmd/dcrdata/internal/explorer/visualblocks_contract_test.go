package explorer

import (
	"encoding/json"
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestVisualBlocksDataContract(t *testing.T) {
	params := &chaincfg.Params{
		MaximumBlockSizes: []int{393216},
	}
	issuedSKA := []uint8{1, 2}
	maxBlockSize := float64(params.MaximumBlockSizes[0])

	// Robust shared fixture to verify both transports and the coinbase search logic.
	rows := []types.CoinRowData{
		{CoinType: 0, Symbol: "VAR", TxCount: 1, Amount: "100", Size: 10000},
		{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "50", Size: 5000},
	}
	bi := &types.BlockInfo{
		BlockBasic: &types.BlockBasic{
			Size:     15000,
			CoinRows: rows,
		},
		Tx: []*types.TrimmedTxInfo{
			{
				TxBasic: &types.TxBasic{
					Size:  3000,
					Total: 1000000, // High total ensures it's before coinbase in typical sort
					VoteInfo: &types.VoteInfo{
						Validation: types.BlockValidation{Validity: true},
					},
				},
				Voted: true,
			},
			{
				TxBasic: &types.TxBasic{Size: 2000, Coinbase: true, Total: 100},
			},
		},
		RegularCoinCounts: []types.CoinCount{
			{CoinType: 0, Symbol: "VAR", Count: 1},
			{CoinType: 1, Symbol: "SKA1", Count: 1},
		},
	}

	t.Run("BlockContractWireFormat", func(t *testing.T) {
		trimmed := bi.Trim(maxBlockSize, issuedSKA)
		data, err := json.Marshal(trimmed)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		var wire map[string]interface{}
		if err := json.Unmarshal(data, &wire); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}

		if wire["max_block_size"] != maxBlockSize {
			t.Errorf("Wire MaxBlockSize mismatch: got %v, want %v", wire["max_block_size"], maxBlockSize)
		}
		if wire["size"] != float64(15000) {
			t.Errorf("Wire Size mismatch: got %v, want 15000", wire["size"])
		}
		if wire["regular_coin_counts"] == nil {
			t.Error("Wire Block: regular_coin_counts is missing")
		}

		txs := wire["transactions"].([]interface{})
		if len(txs) != 1 {
			t.Errorf("Wire Block: Expected 1 regular transaction (coinbase filtered), got %d", len(txs))
		}
		foundVote := false
		for _, txRaw := range txs {
			tx := txRaw.(map[string]interface{})
			if tx["voted"] == true {
				foundVote = true
			}
		}
		if !foundVote {
			t.Error("Wire Block: No transaction found with voted=true")
		}
	})

	t.Run("BlockWSWireFormatEquivalence", func(t *testing.T) {
		// 1. Generate HTTP wire as the gold standard
		trimmed := bi.Trim(maxBlockSize, issuedSKA)
		httpData, _ := json.Marshal(trimmed)
		var httpWire map[string]interface{}
		json.Unmarshal(httpData, &httpWire)

		// 2. Generate WS wire (simulate handler's patch sequence)
		blockCopy := *bi
		blockCopy.CoinFills = trimmed.CoinFills
		blockCopy.ActiveSKACount = trimmed.ActiveSKACount
		blockCopy.MaxBlockSize = trimmed.MaxBlockSize

		wsData, err := json.Marshal(blockCopy)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}
		var wsWire map[string]interface{}
		if err := json.Unmarshal(wsData, &wsWire); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}

		// 3. Verify that the data contract fields are IDENTICAL across transports
		contractFields := []string{"regular_coin_counts", "coin_fills", "active_ska_count", "max_block_size"}
		for _, f := range contractFields {
			// Use JSON marshaling to compare potentially complex types like slices
			hVal, _ := json.Marshal(httpWire[f])
			wVal, _ := json.Marshal(wsWire[f])
			if string(hVal) != string(wVal) {
				t.Errorf("Cross-transport mismatch for field %s: HTTP=%s, WS=%s", f, string(hVal), string(wVal))
			}
		}
	})

	t.Run("MempoolContractWireFormat", func(t *testing.T) {
		mpi := &types.MempoolInfo{
			MempoolShort: types.MempoolShort{
				TotalSize: 20000,
			},
		}

		trimmed := mpi.Trim(maxBlockSize)
		data, err := json.Marshal(trimmed)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}

		var wire map[string]interface{}
		if err := json.Unmarshal(data, &wire); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}

		if wire["max_block_size"] != maxBlockSize {
			t.Errorf("Wire MaxBlockSize mismatch: got %v, want %v", wire["max_block_size"], maxBlockSize)
		}
		if wire["total_size"] != float64(20000) {
			t.Errorf("Wire TotalSize mismatch: got %v, want 20000", wire["total_size"])
		}
	})
}
