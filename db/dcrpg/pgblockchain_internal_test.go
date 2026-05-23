package dcrpg

import (
	"encoding/json"
	"math/big"
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"
)

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
				"vin": [{"SkaAmountIn": "1000"}],
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

			if tt.expectRateOk && tx.FeeRateRaw == "" {
				t.Errorf("expected non-empty fee rate for tx with fee")
			}
			if !tt.expectRateOk && tx.FeeRateRaw != "" && tx.FeeRateRaw != "0" {
				t.Errorf("expected empty or zero fee rate for coinbase, got %s", tx.FeeRateRaw)
			}
		})
	}
}
