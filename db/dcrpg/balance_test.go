//go:build pgonline

package dcrpg

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
)

func TestRetrieveAddressBalance_ExcludeBurn(t *testing.T) {
	ctx := context.Background()
	address := fmt.Sprintf("TestAddressExcludeBurn%d", time.Now().UnixNano())

	tx, err := sqlDb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	// 1. Issuance: 1000 coins (VAR)
	txHashIss := []byte(fmt.Sprintf("txhashIss%d", time.Now().UnixNano()))
	var voutIDIss uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 0, 0, $2, 0, 'pkh') RETURNING id`, txHashIss, 1000).Scan(&voutIDIss)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`, address, txHashIss, 1000, voutIDIss)
	if err != nil {
		t.Fatal(err)
	}
	// Mark as coinbase (prev_tx_hash = 0)
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type) VALUES ($1, 0, 0, $2, 4294967295, 0, 0, 0, 0)`, txHashIss, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}

	// 2. Regular Funding: 100 coins (VAR)
	txHash1 := []byte(fmt.Sprintf("txhash1%d", time.Now().UnixNano()))
	var voutID1 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 0, 0, $2, 0, 'pkh') RETURNING id`, txHash1, 100).Scan(&voutID1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`, address, txHash1, 100, voutID1)
	if err != nil {
		t.Fatal(err)
	}
	// Regular transfer has a prev_tx_hash
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type) VALUES ($1, 0, 0, $2, 0, 0, 100, 0, 0)`, txHash1, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// 3. Stake Income (PoS): 50 coins (VAR)
	txHashS1 := []byte(fmt.Sprintf("txhashS1%d", time.Now().UnixNano()))
	var voutIDS1 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 0, 0, $2, 0, 'pkh') RETURNING id`, txHashS1, 50).Scan(&voutIDS1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), $5)`, address, txHashS1, 50, voutIDS1, dbtypes.TxTypeSSFeePoS)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type) VALUES ($1, 0, 0, $2, 0, 0, 50, 0, 2)`, txHashS1, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// 4. Miner Income (PoW): 20 coins (VAR)
	txHashS2 := []byte(fmt.Sprintf("txhashS2%d", time.Now().UnixNano()))
	var voutIDS2 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 0, 0, $2, 0, 'pkh') RETURNING id`, txHashS2, 20).Scan(&voutIDS2)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), $5)`, address, txHashS2, 20, voutIDS2, dbtypes.TxTypeSSFeePoW)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type) VALUES ($1, 0, 0, $2, 0, 0, 20, 0, 2)`, txHashS2, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// 5. Regular Spending: 30 coins (VAR)
	txHash3 := []byte(fmt.Sprintf("txhash3%d", time.Now().UnixNano()))
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, false, $4, $5, true, now(), 0)`, address, txHash3, 30, txHash1, voutID1)
	if err != nil {
		t.Fatal(err)
	}

	// 5b. Change Output: 1190 coins (VAR)
	var voutID3 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 1, 0, $2, 0, 'pkh') RETURNING id`, txHash3, 1190).Scan(&voutID3)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`, address, txHash3, 1190, voutID3)
	if err != nil {
		t.Fatal(err)
	}

	// 6. SKA Funding: 1000 coins (SKA1)
	txHashS1_S := []byte(fmt.Sprintf("txhashS1_S%d", time.Now().UnixNano()))
	var voutIDS1_S uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, ska_value, script_type) VALUES ($1, 0, 0, 0, 1, '1000', 'pkh') RETURNING id`, txHashS1_S).Scan(&voutIDS1_S)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type, ska_value) VALUES ($1, $2, 0, 1, true, $3, true, now(), 0, '1000')`, address, txHashS1_S, voutIDS1_S)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type) VALUES ($1, 0, 0, $2, 0, 0, 1000, 1, 0)`, txHashS1_S, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// 7. SKA Spending: 400 coins (SKA1)
	txHashS2_S := []byte(fmt.Sprintf("txhashS2_S%d", time.Now().UnixNano()))
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type, ska_value) VALUES ($1, $2, 0, 1, false, $3, $4, true, now(), 0, '')`, address, txHashS2_S, txHashS1_S, voutIDS1_S)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`, txHashS2_S, address, txHashS1_S)
	if err != nil {
		t.Fatal(err)
	}

	// 7b. SKA Change: 600 coins (SKA1)
	var voutIDS2_S uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, ska_value, script_type) VALUES ($1, 1, 0, 0, 1, '600', 'pkh') RETURNING id`, txHashS2_S).Scan(&voutIDS2_S)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type, ska_value) VALUES ($1, $2, 0, 1, true, $3, true, now(), 0, '600')`, address, txHashS2_S, voutIDS2_S)
	if err != nil {
		t.Fatal(err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		sqlDb.Exec(`DELETE FROM addresses WHERE address = $1`, address)
		sqlDb.Exec(`DELETE FROM vouts WHERE tx_hash IN (SELECT tx_hash FROM addresses WHERE address = $1)`, address)
		sqlDb.Exec(`DELETE FROM vins WHERE tx_hash IN (SELECT tx_hash FROM addresses WHERE address = $1)`, address)
	}()

	bal, err := retrieveAddressBalance(ctx, sqlDb, address)
	if err != nil {
		t.Fatalf("retrieveAddressBalance failed: %v", err)
	}

	cbVAR, ok := bal.Coins[0]
	if !ok {
		t.Fatal("Coin 0 balance not found")
	}
	if cbVAR.TotalUnspent != 1190 {
		t.Errorf("VAR Expected TotalUnspent 1190, got %d", cbVAR.TotalUnspent)
	}
	if cbVAR.TotalSpent != 30 {
		t.Errorf("VAR Expected TotalSpent 30, got %d", cbVAR.TotalSpent)
	}
	if cbVAR.TotalReceived != 2270 {
		t.Errorf("VAR Expected TotalReceived 2270, got %d", cbVAR.TotalReceived)
	}
	
	// Ratio = 50 / (100 + 50 + 20) = 50 / 170 = 29.4118%
	// Note: 20 is PoW, so it's excluded from numerator but included in denominator
	expectedRatio := 50.0 / 170.0
	if fmt.Sprintf("%.4f", cbVAR.FromStake) != fmt.Sprintf("%.4f", expectedRatio) {
		t.Errorf("VAR Expected FromStake %.4f, got %.4f", expectedRatio, cbVAR.FromStake)
	}

	cbSKA, okSKA := bal.Coins[1]
	if !okSKA {
		t.Fatal("Coin 1 balance not found")
	}
	if cbSKA.TotalUnspentSKA != "600" {
		t.Errorf("SKA1 Expected TotalUnspentSKA 600, got %s", cbSKA.TotalUnspentSKA)
	}
	if cbSKA.TotalReceivedSKA != "1000" {
		t.Errorf("SKA1 Expected TotalReceivedSKA 1000, got %s", cbSKA.TotalReceivedSKA)
	}
	if cbSKA.TotalSpentSKA != "400" {
		t.Errorf("SKA1 Expected TotalSpentSKA 400, got %s", cbSKA.TotalSpentSKA)
	}
}
