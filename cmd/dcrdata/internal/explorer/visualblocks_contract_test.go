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
		wantRatio := float64(15000) / maxBlockSize
		if got, ok := wire["total_fill_ratio"].(float64); !ok || got != wantRatio {
			t.Errorf("Wire TotalFillRatio mismatch: got %v, want %v", wire["total_fill_ratio"], wantRatio)
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
		blockCopy.RegularCoinCounts = trimmed.RegularCoinCounts
		blockCopy.TotalFillRatio = trimmed.TotalFillRatio

		wsData, err := json.Marshal(blockCopy)
		if err != nil {
			t.Fatalf("Marshal failed: %v", err)
		}
		var wsWire map[string]interface{}
		if err := json.Unmarshal(wsData, &wsWire); err != nil {
			t.Fatalf("Unmarshal failed: %v", err)
		}

		// 3. Verify that the data contract fields are IDENTICAL across transports
		contractFields := []string{"regular_coin_counts", "coin_fills", "active_ska_count", "max_block_size", "total_fill_ratio"}
		for _, f := range contractFields {
			// Use JSON marshaling to compare potentially complex types like slices
			hVal, _ := json.Marshal(httpWire[f])
			wVal, _ := json.Marshal(wsWire[f])
			if string(hVal) != string(wVal) {
				t.Errorf("Cross-transport mismatch for field %s: HTTP=%s, WS=%s", f, string(hVal), string(wVal))
			}
		}
	})

	t.Run("BlockFeeParity", func(t *testing.T) {
		// Self-contained fixture with known fee values.
		// FeeRateRaw values are derived as fee * 1000 / size to lock in atoms/kB:
		//   regular:  10000000 * 1000 / 500 = 20000000
		//   stake:    5000000  * 1000 / 250 = 20000000
		//   ska fee:  2500000000000000000 * 1000 / 200 = 12500000000000000000
		const (
			feeRaw       = "10000000"
			feeRateRaw   = "20000000"
			coinbaseRaw  = "0"
			coinbaseRate = "0"
			stakeFeeRaw  = "5000000"
			stakeFeeRate = "20000000"
			skaFeeRaw    = "2500000000000000000"
			skaFeeRate   = "12500000000000000000"
		)
		feeBI := &types.BlockInfo{
			BlockBasic: &types.BlockBasic{Size: 10000},
			MiningFee:  1.23456789,
			Tx: []*types.TrimmedTxInfo{
				{
					TxBasic: &types.TxBasic{
						Size: 500, FeeRaw: feeRaw, FeeRateRaw: feeRateRaw,
					},
				},
				{
					TxBasic: &types.TxBasic{
						Size: 400, Coinbase: true, FeeRaw: coinbaseRaw, FeeRateRaw: coinbaseRate,
					},
				},
			},
			StakeFees: []*types.TrimmedTxInfo{
				{
					TxBasic: &types.TxBasic{CoinType: 0, FeeRaw: stakeFeeRaw, FeeRateRaw: stakeFeeRate},
				},
				{
					TxBasic: &types.TxBasic{CoinType: 1, FeeRaw: skaFeeRaw, FeeRateRaw: skaFeeRate},
				},
			},
		}

		// 1. HTTP wire via Trim (mirrors BlockContractWireFormat)
		trimmed := feeBI.Trim(maxBlockSize, issuedSKA)
		httpData, _ := json.Marshal(trimmed)
		var httpWire map[string]interface{}
		json.Unmarshal(httpData, &httpWire)

		// 2. WS wire via Trim + patch (mirrors BlockWSWireFormatEquivalence and websockethandlers.go:284-288)
		blockCopy := *feeBI
		blockCopy.CoinFills = trimmed.CoinFills
		blockCopy.ActiveSKACount = trimmed.ActiveSKACount
		blockCopy.MaxBlockSize = trimmed.MaxBlockSize
		blockCopy.RegularCoinCounts = trimmed.RegularCoinCounts

		wsData, err := json.Marshal(types.WebsocketBlock{Block: &blockCopy})
		if err != nil {
			t.Fatalf("WS Marshal failed: %v", err)
		}
		var wsRaw map[string]interface{}
		if err := json.Unmarshal(wsData, &wsRaw); err != nil {
			t.Fatalf("WS Unmarshal failed: %v", err)
		}
		wsWire, ok := wsRaw["block"].(map[string]interface{})
		if !ok {
			t.Fatal("WS wire: missing block wrapper")
		}

		// 3. Cross-wire: MiningFee == Fees
		httpFees, ok := httpWire["fees"].(float64)
		if !ok {
			t.Fatal("HTTP wire: fees missing")
		}
		wsFees, ok := wsWire["MiningFee"].(float64)
		if !ok {
			t.Fatal("WS wire: MiningFee missing")
		}
		if httpFees != wsFees {
			t.Errorf("Fee total cross-wire mismatch: HTTP[ fees ]=%v, WS[ MiningFee ]=%v", httpFees, wsFees)
		}

		// 4. Cross-wire: Transactions[].FeeRaw and FeeRateRaw
		httpTx := httpWire["transactions"].([]interface{})
		wsTx := wsWire["Tx"].([]interface{})
		if len(httpTx) != 1 {
			t.Fatalf("HTTP wire: expected 1 non-coinbase tx, got %d", len(httpTx))
		}
		if len(wsTx) != 2 {
			t.Fatalf("WS wire: expected 2 tx entries, got %d", len(wsTx))
		}
		// Coinbase is index 1 on WS, absent on HTTP
		wsCB, ok := wsTx[1].(map[string]interface{})
		if !ok {
			t.Fatal("WS wire: tx[1] not a map")
		}
		cbVal, _ := wsCB["Coinbase"].(bool)
		if !cbVal {
			t.Error("WS wire: tx[1] expected coinbase")
		}

		// Regular tx at index 0 on both wires
		hTx, ok := httpTx[0].(map[string]interface{})
		if !ok {
			t.Fatal("HTTP wire: transactions[0] not a map")
		}
		wTx, ok := wsTx[0].(map[string]interface{})
		if !ok {
			t.Fatal("WS wire: Tx[0] not a map")
		}
		if got, want := wTx["FeeRaw"].(string), hTx["FeeRaw"].(string); got != want {
			t.Errorf("Regular tx FeeRaw cross-wire mismatch: HTTP=%s, WS=%s", want, got)
		}
		if got, want := wTx["FeeRateRaw"].(string), hTx["FeeRateRaw"].(string); got != want {
			t.Errorf("Regular tx FeeRateRaw cross-wire mismatch: HTTP=%s, WS=%s", want, got)
		}
		// Also verify the values lock in atoms/kB
		if hTx["FeeRaw"].(string) != feeRaw {
			t.Errorf("HTTP fee raw: got %s, want %s", hTx["FeeRaw"].(string), feeRaw)
		}
		if hTx["FeeRateRaw"].(string) != feeRateRaw {
			t.Errorf("HTTP fee rate raw: got %s, want %s", hTx["FeeRateRaw"].(string), feeRateRaw)
		}

		// 5. StakeFees: WS only (no HTTP counterpart). Assert round-trip correctness.
		wsSF, ok := wsWire["StakeFees"].([]interface{})
		if !ok {
			t.Fatal("WS wire: StakeFees missing")
		}
		for i, sfRaw := range wsSF {
			sf := sfRaw.(map[string]interface{})
			if got := sf["FeeRaw"].(string); got != feeBI.StakeFees[i].FeeRaw {
				t.Errorf("StakeFees[%d] FeeRaw: WS=%s, expected=%s", i, got, feeBI.StakeFees[i].FeeRaw)
			}
			if got := sf["FeeRateRaw"].(string); got != feeBI.StakeFees[i].FeeRateRaw {
				t.Errorf("StakeFees[%d] FeeRateRaw: WS=%s, expected=%s", i, got, feeBI.StakeFees[i].FeeRateRaw)
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
