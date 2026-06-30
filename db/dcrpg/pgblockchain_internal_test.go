package dcrpg

import (
	"encoding/json"
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
)

func TestSSFeeNetReward(t *testing.T) {
	tests := []struct {
		name  string
		msgTx *wire.MsgTx
		want  string
	}{
		{
			name: "null input SKA",
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn:    []*wire.TxIn{{}},
				TxOut: []*wire.TxOut{
					{CoinType: 1, SKAValue: big.NewInt(5000000000000000000)},
				},
			},
			want: "5000000000000000000",
		},
		{
			name: "consolidation SKA",
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn:    []*wire.TxIn{{SKAValueIn: big.NewInt(1000000000000000000)}},
				TxOut: []*wire.TxOut{
					{CoinType: 1, SKAValue: big.NewInt(2000000000000000000)},
				},
			},
			want: "1000000000000000000",
		},
		{
			name: "null input VAR",
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn:    []*wire.TxIn{{}},
				TxOut:   []*wire.TxOut{{Value: 100000000, CoinType: 0}},
			},
			want: "100000000",
		},
		{
			name: "zero reward SKA",
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn:    []*wire.TxIn{{SKAValueIn: big.NewInt(5000000000000000000)}},
				TxOut: []*wire.TxOut{
					{CoinType: 1, SKAValue: big.NewInt(5000000000000000000)},
				},
			},
			want: "0",
		},
		{
			name: "coinbase SKA input skipped",
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn: []*wire.TxIn{{
					PreviousOutPoint: wire.OutPoint{
						Hash:  chainhash.Hash{},
						Index: wire.MaxPrevOutIndex,
					},
					SKAValueIn: big.NewInt(2382000000000000000),
				}},
				TxOut: []*wire.TxOut{
					{CoinType: 1, SKAValue: big.NewInt(2382000000000000000)},
				},
			},
			want: "2382000000000000000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ssFeeNetReward(tt.msgTx).String()
			if got != tt.want {
				t.Errorf("ssFeeNetReward = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestTrimmedTxInfoFromMsgTx_Fees(t *testing.T) {
	params := &chaincfg.Params{}
	ticketPrice := int64(100000000)

	tests := []struct {
		name         string
		txjson       string
		msgTx        *wire.MsgTx
		expectedFee  string
		expectRateOk bool
	}{
		{
			name: "VAR tx with fee",
			txjson: `{
				"txid": "var-tx-id",
				"vin": [{"value_in": 100000000}],
				"vout": [{"value": 90000000}]
			}`,
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn: []*wire.TxIn{
					{ValueIn: 100000000},
				},
				TxOut: []*wire.TxOut{
					{Value: 90000000, CoinType: 0},
				},
			},
			expectedFee:  "10000000",
			expectRateOk: true,
		},
		{
			name: "SKA tx with fee",
			txjson: `{
				"txid": "ska-tx-id",
				"vin": [{"skaamountin": "1000"}],
				"vout": [{"value": 0}],
				"coin_type": 1
			}`,
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn: []*wire.TxIn{
					{},
				},
				TxOut: []*wire.TxOut{
					{Value: 0, CoinType: 1, SKAValue: big.NewInt(900)},
				},
			},
			expectedFee:  "100",
			expectRateOk: true,
		},
		{
			name: "Coinbase tx no fee",
			txjson: `{
				"txid": "coinbase-tx-id",
				"vin": [{"coinbase": "true"}],
				"vout": [{"value": 100000000}]
			}`,
			msgTx: &wire.MsgTx{
				Version: 1,
				TxIn: []*wire.TxIn{
					{},
				},
				TxOut: []*wire.TxOut{
					{Value: 100000000, CoinType: 0},
				},
			},
			expectedFee:  "0",
			expectRateOk: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var txraw chainjson.TxRawResult
			if err := json.Unmarshal([]byte(tt.txjson), &txraw); err != nil {
				t.Fatalf("failed to unmarshal txjson: %v", err)
			}

			tx, _ := trimmedTxInfoFromMsgTx(&txraw, ticketPrice, tt.msgTx, params)

			if tx.FeeRaw != tt.expectedFee {
				t.Errorf("expected fee %s, got %s", tt.expectedFee, tx.FeeRaw)
			}

			if tt.expectRateOk {
				if tx.FeeRateRaw == "" || tx.FeeRateRaw == "0" {
					t.Errorf("expected non-zero fee rate for tx with fee, got %s", tx.FeeRateRaw)
				} else {
					// Verify fee rate is in atoms/kB: rate = fee * 1000 / size
					feeBig := new(big.Int)
					feeBig.SetString(tt.expectedFee, 10)
					expectedRate := new(big.Int).Mul(feeBig, big.NewInt(1000))
					txSize := int64(tt.msgTx.SerializeSize())
					if txSize > 0 {
						expectedRate.Quo(expectedRate, big.NewInt(txSize))
						if tx.FeeRateRaw != expectedRate.String() {
							t.Errorf("expected fee rate %s atoms/kB (fee=%s, size=%d), got %s",
								expectedRate.String(), tt.expectedFee, txSize, tx.FeeRateRaw)
						}
					}
				}
			} else {
				if tx.FeeRateRaw != "" && tx.FeeRateRaw != "0" {
					t.Errorf("expected empty or zero fee rate for coinbase, got %s", tx.FeeRateRaw)
				}
			}
		})
	}
}

func skaBalancesFromCoins(coins map[uint8]*dbtypes.CoinBalance) map[uint8]apitypes.SKABalance {
	var skaBalances map[uint8]apitypes.SKABalance
	for coinType, balance := range coins {
		if coinType == 0 {
			continue
		}
		if skaBalances == nil {
			skaBalances = make(map[uint8]apitypes.SKABalance, len(coins)-1)
		}
		coinsSpent := balance.TotalSpentSKA
		if coinsSpent == "" {
			coinsSpent = "0"
		}
		coinsUnspent := balance.TotalUnspentSKA
		if coinsUnspent == "" {
			coinsUnspent = "0"
		}
		skaBalances[coinType] = apitypes.SKABalance{
			NumSpent:     balance.NumSpent,
			NumUnspent:   balance.NumUnspent,
			CoinsSpent:   coinsSpent,
			CoinsUnspent: coinsUnspent,
		}
	}
	return skaBalances
}

func TestBuildSKABalances(t *testing.T) {
	tests := []struct {
		name  string
		coins map[uint8]*dbtypes.CoinBalance
		want  map[uint8]apitypes.SKABalance
	}{
		{
			name:  "nil coins",
			coins: nil,
			want:  nil,
		},
		{
			name: "VAR only",
			coins: map[uint8]*dbtypes.CoinBalance{
				0: {NumSpent: 1, NumUnspent: 2, TotalSpent: 100, TotalUnspent: 200},
			},
			want: nil,
		},
		{
			name: "SKA only - fully spent (empty unspent)",
			coins: map[uint8]*dbtypes.CoinBalance{
				1: {NumSpent: 1, NumUnspent: 0, TotalSpentSKA: "5000000000000000000", TotalUnspentSKA: ""},
			},
			want: map[uint8]apitypes.SKABalance{
				1: {NumSpent: 1, NumUnspent: 0, CoinsSpent: "5000000000000000000", CoinsUnspent: "0"},
			},
		},
		{
			name: "SKA only - empty spent (fully unmined)",
			coins: map[uint8]*dbtypes.CoinBalance{
				1: {NumSpent: 0, NumUnspent: 5, TotalSpentSKA: "", TotalUnspentSKA: "1000000000000000000"},
			},
			want: map[uint8]apitypes.SKABalance{
				1: {NumSpent: 0, NumUnspent: 5, CoinsSpent: "0", CoinsUnspent: "1000000000000000000"},
			},
		},
		{
			name: "SKA only - with unspent",
			coins: map[uint8]*dbtypes.CoinBalance{
				1: {NumSpent: 2, NumUnspent: 3, TotalSpentSKA: "1000000000000000000", TotalUnspentSKA: "2000000000000000000"},
			},
			want: map[uint8]apitypes.SKABalance{
				1: {NumSpent: 2, NumUnspent: 3, CoinsSpent: "1000000000000000000", CoinsUnspent: "2000000000000000000"},
			},
		},
		{
			name: "multiple SKA coins",
			coins: map[uint8]*dbtypes.CoinBalance{
				1: {NumSpent: 1, NumUnspent: 2, TotalSpentSKA: "1000000000000000000", TotalUnspentSKA: "2000000000000000000"},
				2: {NumSpent: 3, NumUnspent: 4, TotalSpentSKA: "3000000000000000000", TotalUnspentSKA: ""},
			},
			want: map[uint8]apitypes.SKABalance{
				1: {NumSpent: 1, NumUnspent: 2, CoinsSpent: "1000000000000000000", CoinsUnspent: "2000000000000000000"},
				2: {NumSpent: 3, NumUnspent: 4, CoinsSpent: "3000000000000000000", CoinsUnspent: "0"},
			},
		},
		{
			name: "mixed VAR + SKA",
			coins: map[uint8]*dbtypes.CoinBalance{
				0: {NumSpent: 1, NumUnspent: 2, TotalSpent: 100, TotalUnspent: 200},
				1: {NumSpent: 3, NumUnspent: 4, TotalSpentSKA: "3000000000000000000", TotalUnspentSKA: "4000000000000000000"},
			},
			want: map[uint8]apitypes.SKABalance{
				1: {NumSpent: 3, NumUnspent: 4, CoinsSpent: "3000000000000000000", CoinsUnspent: "4000000000000000000"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := skaBalancesFromCoins(tt.coins)
			if len(got) != len(tt.want) {
				t.Errorf("skaBalancesFromCoins() returned %d entries, want %d", len(got), len(tt.want))
			}
			for k, v := range tt.want {
				g, ok := got[k]
				if !ok {
					t.Errorf("skaBalancesFromCoins() missing key %d", k)
					continue
				}
				if g != v {
					t.Errorf("skaBalancesFromCoins()[%d] = %+v, want %+v", k, g, v)
				}
			}
		})
	}
}
