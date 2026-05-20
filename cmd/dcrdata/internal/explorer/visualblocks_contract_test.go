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

	t.Run("BlockContractWireFormat", func(t *testing.T) {
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
					TxBasic: &types.TxBasic{Size: 2000, Coinbase: true},
				},
				{
					TxBasic: &types.TxBasic{
						Size: 3000,
						VoteInfo: &types.VoteInfo{
							Validation: types.BlockValidation{Validity: true},
						},
					},
					Voted: true,
				},
			},
		}

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

		txs := wire["transactions"].([]interface{})
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
