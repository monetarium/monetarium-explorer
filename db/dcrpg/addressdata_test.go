package dcrpg

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/monetarium/monetarium-explorer/db/cache"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/db/dcrpg/internal"
	"github.com/monetarium/monetarium-explorer/txhelpers"
	"github.com/monetarium/monetarium-node/chaincfg"
)

type stubMempoolChecker struct{}

func (stubMempoolChecker) UnconfirmedTxnsForAddress(address string) (*txhelpers.AddressOutpoints, map[uint8]int64, error) {
	return txhelpers.NewAddressOutpoints(address), map[uint8]int64{}, nil
}

// TestAddressDataCoinTypesFailureDoesNotFailRequest guards against reusing the
// AddressHistory error for the coin-types lookup. The coin-types query only
// feeds the coin selector, so a failure there (e.g. a canceled request context)
// must not discard the history AddressData already loaded or turn the whole
// request into an error.
func TestAddressDataCoinTypesFailureDoesNotFailRequest(t *testing.T) {
	ctx := context.Background()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	const address = "MsaZ4UaiLh5H1ixXugCCrR8hHNCBZ8vTa9M"

	pgb := &ChainDB{
		db:           db,
		queryTimeout: time.Minute,
		chainParams:  chaincfg.MainNetParams(),
		bestBlock:    &BestBlock{},
		AddressCache: cache.NewAddressCache(10, 10, 1024),
		CacheLocks: cacheLocks{
			cache.NewCacheLock(), cache.NewCacheLock(),
			cache.NewCacheLock(), cache.NewCacheLock(),
		},
		mp: stubMempoolChecker{},
	}

	// AddressHistory finds no confirmed rows (cache miss followed by an empty
	// addresses query).
	mock.ExpectQuery(regexp.QuoteMeta(internal.SelectAddressLimitNByAddressAll)).
		WithArgs(address, int64(3000000), int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "address", "matching_tx_hash", "tx_hash", "tx_type",
			"valid_mainchain", "tx_vin_vout_index", "block_time", "vin_db_id",
			"value", "is_funding", "coin_type", "ska_value",
		}))

	// The secondary coin-types lookup fails with a canceled context.
	mock.ExpectQuery(regexp.QuoteMeta(internal.SelectAddressCoinTypes)).
		WithArgs(address).
		WillReturnError(context.Canceled)

	addrData, err := pgb.AddressData(ctx, address, 20, 0,
		dbtypes.AddrTxnAll, dbtypes.CoinTypeAll)
	if err != nil {
		t.Fatalf("AddressData returned an error despite successful history load: %v", err)
	}
	if addrData == nil {
		t.Fatal("AddressData returned nil data")
	}
	if len(addrData.ActiveCoins) != 0 {
		t.Errorf("expected no active coins after a failed lookup, got %v", addrData.ActiveCoins)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}
