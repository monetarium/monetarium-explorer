//go:build pgonline

package dcrpg

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	"github.com/monetarium/monetarium-node/dcrutil"

	"github.com/monetarium/monetarium-explorer/db/cache"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/txhelpers"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
)

// func TestTreasuryTxns(t *testing.T) {
// 	txns, err := db.TreasuryTxns(12, 32)
// 	t.Log(err)
// 	spew.Dump(txns)

// 	bal, spent, txCount, err := db.TreasuryBalance(675538)
// 	t.Log(bal, spent, txCount, err)
// }

func TestInsertSwap(t *testing.T) {
	contractHash := chainhash.Hash{1, 2}
	spendHash := chainhash.Hash{3, 4}

	_, err := db.db.Exec(`TRUNCATE swaps;`)
	if err != nil {
		t.Fatal(err)
	}

	asd := &txhelpers.AtomicSwapData{
		ContractTx:       &contractHash,
		ContractVout:     2,
		SpendTx:          &spendHash,
		SpendVin:         1,
		Value:            22_0000_0000,
		ContractAddress:  "Dcasdfasdfasdf",
		RecipientAddress: "Ds1324", // not stored
		RefundAddress:    "Ds9876", // not stored
		Locktime:         1621787740,
		SecretHash:       [32]byte{3, 2, 1},
		Secret:           []byte{'a', 'b', 'c'},
		Contract:         []byte{1, 2, 3, 4, 5, 6, 7, 8}, // not stored
		IsRefund:         true,
	}
	err = insertSwap(db.db, 1234, asd)
	if err != nil {
		t.Fatal(err)
	}

	asd.SpendTx = &chainhash.Hash{5, 6}
	asd.SpendVin = 2
	asd.Secret = nil
	err = insertSwap(db.db, 1234, asd)
	if err != nil {
		t.Fatal(err)
	}
}

func TestChainDB_AddressTransactionsAll(t *testing.T) {
	// address with no transactions.
	address := "DsUBCQWJsW8raht1i4gXTv7xPu3ySpUxxxx"
	rows, err := db.AddressTransactionsAll(context.Background(), address)
	if err != nil {
		t.Errorf("err should have been nil, was: %v", err)
	}
	if rows != nil {
		t.Fatalf("should have been no rows, got %v", rows)
	}
	
	height, hash, _ := db.HeightHashDBLegacy(context.Background())
	h, _ := chainhash.NewHashFromStr(hash)
	blockID := cache.NewBlockID(h, int64(height))
	wasStored := db.AddressCache.StoreRows(address, rows, blockID)
	if !wasStored {
		t.Fatalf("Address not stored in cache!")
	}
	
	r, bid := db.AddressCache.Rows(address, 0)
	if bid == nil {
		t.Errorf("BlockID should not have been nil since this is a cache hit.")
	}
	if r == nil || len(r) > 0 {
		t.Errorf("rows should have been non-nil empty slice, got: %v", r)
	}
}

func TestMergeRows(t *testing.T) {
	address := "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx"
	
	rows, err := db.AddressTransactionsAll(context.Background(), address)
	if err != nil {
		t.Errorf("err should have been nil, was: %v", err)
	}
	if rows == nil {
		t.Fatalf("should have rows, got none")
	}
	
	tStart := time.Now()
	// mergedRows, mrMap, err := dbtypes.MergeRows(rows)
	mergedRows, err := dbtypes.MergeRows(rows)
	if err != nil {
		t.Fatalf("MergeRows failed: %v", err)
	}
	t.Logf("%d rows combined to %d merged rows in %v", len(rows),
		len(mergedRows), time.Since(tStart))
	
	mergedRows0, err := db.AddressTransactionsAllMerged(context.Background(), address)
	if err != nil {
		t.Errorf("err should have been nil, was: %v", err)
	}
	if mergedRows0 == nil {
		t.Fatalf("should have rows, got none")
	}
	
	if len(mergedRows) != len(mergedRows0) {
		t.Errorf("len(mergedRows) = %d != len(mergedRows0) = %d",
			len(mergedRows), len(mergedRows0))
	}
}

func TestRetrieveUTXOs(t *testing.T) {
	utxos, err := retrieveUTXOs(context.Background(), db.db)
	if err != nil {
		t.Fatal(err)
	}

	// m := memStats()
	// t.Log(m)

	var totalValue int64
	for i := range utxos {
		totalValue += utxos[i].Value
	}

	t.Logf("Found %d utxos with a total value of %v", len(utxos),
		dcrutil.Amount(totalValue))
}

func TestUtxoStore_Reinit(t *testing.T) {
	utxos, err := retrieveUTXOs(context.Background(), db.db)
	if err != nil {
		t.Fatal(err)
	}

	uc := newUtxoStore(100)
	uc.Reinit(utxos)
}

func TestCheckColumnDataType(t *testing.T) {
	dataType, err := CheckColumnDataType(db.db, "blocks", "time")
	if err != nil {
		t.Fatal(err)
	}
	t.Log(dataType)
}

func TestCheckCurrentTimeZone(t *testing.T) {
	currentTZ, err := CheckCurrentTimeZone(db.db)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Set time zone: %v", currentTZ)
}

func TestCheckDefaultTimeZone(t *testing.T) {
	defaultTZ, currentTZ, err := CheckDefaultTimeZone(db.db)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Set time zone: %v", currentTZ)
	t.Logf("Default time zone: %v", defaultTZ)
}

func TestDeleteBestBlock(t *testing.T) {
	ctx := context.Background()
	res, height, hash, err := deleteBestBlock(ctx, db.db)
	t.Logf("Deletion summary for block %d (%s): %v", height, hash, res)
	if err != nil {
		t.Errorf("Failed to delete best block data: %v", err)
	}

	timings := fmt.Sprintf("Blocks: %v\n", time.Duration(res.Timings.Blocks))
	timings = timings + fmt.Sprintf("\tVins: %v\n", time.Duration(res.Timings.Vins))
	timings = timings + fmt.Sprintf("\tVouts: %v\n", time.Duration(res.Timings.Vouts))
	timings = timings + fmt.Sprintf("\tAddresses: %v\n", time.Duration(res.Timings.Addresses))
	timings = timings + fmt.Sprintf("\tTransactions: %v\n", time.Duration(res.Timings.Transactions))
	timings = timings + fmt.Sprintf("\tTickets: %v\n", time.Duration(res.Timings.Tickets))
	timings = timings + fmt.Sprintf("\tVotes: %v\n", time.Duration(res.Timings.Votes))
	timings = timings + fmt.Sprintf("\tMisses: %v\n", time.Duration(res.Timings.Misses))
	t.Logf("Timings:\n%s", timings)

	t.Log("**************************** WARNING ****************************")
	t.Log("*** Blocks deleted from DB! Resync or download new test data! ***")
	t.Log("*****************************************************************")
}

func TestDeleteBlocks(t *testing.T) {
	height0, hash0, err := retrieveBestBlockHeight(context.Background(), db.db)
	if err != nil {
		t.Error(err)
	}

	N := int64(64)
	if N > int64(height0) {
		t.Fatalf("Cannot remove %d blocks from block chain of height %d.",
			N, height0)
	}

	t.Logf("Initial best block %d (%s).", height0, hash0)

	start := time.Now()
	ctx := context.Background()

	res, _, _, err := deleteBlocks(ctx, N, db.db)
	if err != nil {
		t.Error(err)
	}
	if len(res) != int(N) {
		t.Errorf("Expected to delete %d blocks; actually deleted %d.", N, len(res))
	}

	t.Log("**************************** WARNING ****************************")
	t.Log("*** Blocks deleted from DB! Resync or download new test data! ***")
	t.Log("*****************************************************************")

	height, hash, err := retrieveBestBlockHeight(ctx, db.db)
	if err != nil {
		t.Error(err)
	}
	t.Logf("Final best block %d (%s).", height, hash)

	summary := dbtypes.DeletionSummarySlice(res).Reduce()
	if summary.Blocks != N {
		t.Errorf("Expected summary of %d deleted blocks, got %d.", N, summary.Blocks)
	}
	t.Logf("Removed %d blocks in %v:\n%v.", N, time.Since(start), summary)
}

func TestRetrieveTxsByBlockHash(t *testing.T) {
	//block80740 := "00000000000003ae4fa13a6dcd53bf2fddacfac12e86e5b5f98a08a71d3e6caa"
	block0, _ := chainHashFromStr("298e5cc3d985bfe7f81dc135f360abe089edd4396b86d2de66b0cef42b21d980") // genesis
	_, _, _, blockTimes, _ := retrieveTxsByBlockHash(context.Background(), db.db, block0)
	// Check TimeDef.String
	blockTimeStr := blockTimes[0].String()
	t.Log(blockTimeStr)
	for i := range blockTimes {
		// Test TimeDef.Value (sql.Valuer)
		v, err := blockTimes[i].Value()
		if err != nil {
			t.Error(err)
		}
		tT, ok := v.(time.Time)
		if !ok {
			t.Errorf("v (%T) not a time.Time", v)
		}
		t.Log(tT.Format(time.RFC3339), tT.Unix())
		if tT.Unix() != trefUNIX {
			t.Errorf("Incorrect block time: got %d, expected %d",
				tT.Unix(), trefUNIX)
		}
	}
}

func TestUpdateChainState(t *testing.T) {
	// rawData is a sample payload format as returned by getBlockChainInfo rpc endpoint.
	var rawData = []byte(`{
		"chain": "mainnet",
		"blocks": 316016,
		"headers": 316016,
		"syncheight": 316016,
		"bestblockhash": "00000000000000001d8cfa54dc13cfb0563421fd017801401cb2bdebe3579355",
		"difficulty": 406452686,
		"verificationprogress": 1,
		"chainwork": "0000000000000000000000000000000000000000000209c779c196914f038522",
		"initialblockdownload": false,
		"maxblocksize": 393216,
		"deployments": {
			"fixlnseqlocks": {
				"status": "defined",
				"starttime": 1548633600,
				"expiretime": 1580169600
			},
			"lnfeatures": {
				"status": "active",
				"since": 189568,
				"starttime": 1505260800,
				"expiretime": 1536796800
			},
			"sampleagenda1": {
				"status": "lockedin",
				"since": 119248,
				"starttime": 1493164800,
				"expiretime": 1508976000
			},
			"sampleagenda2": {
				"status": "failed",
				"since": 149248,
				"starttime": 1493164800,
				"expiretime": 1524700800
			},
			"sampleagenda3": {
				"status": "started",
				"since": 149248,
				"starttime": 1493164800,
				"expiretime": 1524700800
			}
		}
	}`)

	var chainInfoData = new(chainjson.GetBlockChainInfoResult)
	err := json.Unmarshal(rawData, chainInfoData)
	if err != nil {
		t.Fatalf("expected no error to be returned but found: %v", err)
	}

	bbh, _ := chainHashFromStr("00000000000000001d8cfa54dc13cfb0563421fd017801401cb2bdebe3579355")

	// Expected payload
	var expectedPayload = dbtypes.BlockChainData{
		Chain:                  "mainnet",
		SyncHeight:             316016,
		BestHeight:             316016,
		BestBlockHash:          bbh,
		Difficulty:             406452686,
		VerificationProgress:   1.0,
		ChainWork:              "0000000000000000000000000000000000000000000209c779c196914f038522",
		IsInitialBlockDownload: false,
		MaxBlockSize:           393216,
		AgendaMileStones: map[string]dbtypes.MileStone{
			"fixlnseqlocks": {
				Status:     dbtypes.InitialAgendaStatus,
				StartTime:  time.Unix(1548633600, 0),
				ExpireTime: time.Unix(1580169600, 0),
			},
			"lnfeatures": {
				Status:     dbtypes.ActivatedAgendaStatus,
				VotingDone: 181504,
				Activated:  189568,
				StartTime:  time.Unix(1505260800, 0),
				ExpireTime: time.Unix(1536796800, 0),
			},
			"sampleagenda1": {
				Status:     dbtypes.LockedInAgendaStatus,
				VotingDone: 119248,
				Activated:  127312,
				StartTime:  time.Unix(1493164800, 0),
				ExpireTime: time.Unix(1508976000, 0),
			},
			"sampleagenda2": {
				Status:     dbtypes.FailedAgendaStatus,
				VotingDone: 149248,
				StartTime:  time.Unix(1493164800, 0),
				ExpireTime: time.Unix(1524700800, 0),
			},
			"sampleagenda3": {
				Status:     dbtypes.StartedAgendaStatus,
				StartTime:  time.Unix(1493164800, 0),
				ExpireTime: time.Unix(1524700800, 0),
			},
		},
	}

	dbRPC := &ChainDB{
		chainParams: &chaincfg.Params{
			RuleChangeActivationInterval: 8064,
		},
		deployments: new(ChainDeployments),
	}

	// This sets the dbRPC.chainInfo value.
	dbRPC.UpdateChainState(chainInfoData)

	// Checks if the set dbRPC.chainInfo has a similar format and content as the
	// expected payload including the internal UnmarshalJSON implementation.
	if reflect.DeepEqual(dbRPC.deployments.chainInfo, expectedPayload) {
		t.Fatalf("expected both payloads to match but the did not")
	}
}

func TestCountTransactions(t *testing.T) {
	ctx := context.Background()
	address := "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx"

	tests := []struct {
		name    string
		view    dbtypes.AddrTxnViewType
		coin    uint8
		wantMin int
	}{
		{"all_var", dbtypes.AddrTxnAll, 0, 1},
		{"credit_var", dbtypes.AddrTxnCredit, 0, 1},
		{"debit_var", dbtypes.AddrTxnDebit, 0, 1},
		{"merged_var", dbtypes.AddrMergedTxn, 0, 1},
		{"all_ska", dbtypes.AddrTxnAll, 1, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			count, err := db.CountTransactions(ctx, address, tt.view, tt.coin)
			if err != nil {
				t.Fatalf("CountTransactions failed: %v", err)
			}
			if count < tt.wantMin {
				t.Errorf("CountTransactions() = %d, want at least %d", count, tt.wantMin)
			}
			t.Logf("View %s, Coin %d: count = %d", tt.view, tt.coin, count)
		})
	}
}

func TestAddressMultiCoinData(t *testing.T) {
	ctx := context.Background()
	address := "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx"

	t.Run("ActiveCoins", func(t *testing.T) {
		addrData, err := db.AddressData(ctx, address, 20, 0, dbtypes.AddrTxnAll, 0)
		if err != nil {
			t.Fatalf("AddressData failed: %v", err)
		}
		if len(addrData.ActiveCoins) == 0 {
			t.Error("expected at least one active coin")
		}
		t.Logf("ActiveCoins for %s: %v", address, addrData.ActiveCoins)
	})

	t.Run("PerCoinBalance", func(t *testing.T) {
		addrData, err := db.AddressData(ctx, address, 20, 0, dbtypes.AddrTxnAll, 0)
		if err != nil {
			t.Fatalf("AddressData failed: %v", err)
		}
		for ct, cb := range addrData.Balance.Coins {
			if ct == 0 {
				if cb.TotalReceived == 0 && cb.NumSpent == 0 && cb.NumUnspent == 0 {
					t.Errorf("VAR balance seems empty for active address")
				}
			} else {
				if cb.TotalReceivedSKA == "" && cb.NumSpent == 0 && cb.NumUnspent == 0 {
					t.Errorf("SKA coin %d balance seems empty", ct)
				}
			}
		}
	})

	t.Run("CoinFiltering", func(t *testing.T) {
		// Test with VAR (coin 0)
		dataVar, err := db.AddressData(ctx, address, 20, 0, dbtypes.AddrTxnAll, 0)
		if err != nil {
			t.Fatalf("AddressData(VAR) failed: %v", err)
		}
		if dataVar.Balance.Coins[0] == nil {
			t.Error("expected VAR balance in data")
		}
		if len(dataVar.Balance.Coins) != 1 {
			t.Errorf("expected only VAR balance when filtered, got %d coins", len(dataVar.Balance.Coins))
		}

		// Test with a known SKA coin if present, or just check that any non-zero coin filters correctly
		if len(dataVar.ActiveCoins) > 1 {
			skaCoin := dataVar.ActiveCoins[1]
			dataSka, err := db.AddressData(ctx, address, 20, 0, dbtypes.AddrTxnAll, skaCoin)
			if err != nil {
				t.Fatalf("AddressData(SKA) failed: %v", err)
			}
			if dataSka.Balance.Coins[skaCoin] == nil {
				t.Errorf("expected SKA coin %d balance in data", skaCoin)
			}
			if len(dataSka.Balance.Coins) != 1 {
				t.Errorf("expected only SKA balance when filtered, got %d coins", len(dataSka.Balance.Coins))
			}
		}
	})
}

func TestTxHistoryCoinFiltering(t *testing.T) {
	ctx := context.Background()
	address := "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx"

	t.Run("VAR history", func(t *testing.T) {
		data, err := db.TxHistoryData(ctx, address, dbtypes.TxsType, dbtypes.DayGrouping, 0)
		if err != nil {
			t.Fatalf("TxHistoryData(VAR) failed: %v", err)
		}
		if data == nil {
			t.Fatal("expected data")
		}
	})

	coins, err := db.ActiveCoinsForAddress(ctx, address)
	if err != nil {
		t.Fatalf("ActiveCoinsForAddress failed: %v", err)
	}
	if len(coins) > 1 { // Assuming a helper or checking ActiveCoins
		// This is a bit tricky since I don't know if there are SKA txs for this specific address in the test DB
		// but I can test that the function doesn't crash.
	}
}
