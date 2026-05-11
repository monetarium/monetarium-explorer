package api

import (
	"context"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
)

// addressDS mocks the DataSource for address data testing.
type addressDS struct {
	noopDS
}

func (ds *addressDS) AddressData(ctx context.Context, address string, N, offset int64, txnType dbtypes.AddrTxnViewType, coinType uint8) (*dbtypes.AddressInfo, error) {
	// Return a fixed AddressInfo for testing.
	// Address has VAR (0) and SKA1 (1).
	return &dbtypes.AddressInfo{
		Address:     address,
		ActiveCoins: []uint8{0, 1},
		Balance: &dbtypes.AddressBalance{
			Coins: map[uint8]*dbtypes.CoinBalance{
				0: {CoinType: 0, TotalReceived: 100, TotalSpent: 40, NumUnspent: 60, NumSpent: 40},
				1: {CoinType: 1, TotalReceivedSKA: "1000", TotalSpentSKA: "400", NumUnspent: 60, NumSpent: 40},
			},
			TotalInputs:  40,
			TotalOutputs: 100,
		},
		TxnCount: 100,
	}, nil
}

func TestAddressDataCoinFiltering(t *testing.T) {
	// Test logic will be added here later.
}
