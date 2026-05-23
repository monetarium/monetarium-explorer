//go:build pgonline

package dcrpg

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestRetrieveAddressBalance_ExcludeBurn(t *testing.T) {
	ctx := context.Background()
	address := fmt.Sprintf("TestAddressBurnExclude%d", time.Now().UnixNano())

	// Start transaction to isolate test data
	tx, err := sqlDb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	// 1. Regular Funding: 100 coins (VAR)
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

	// 2. Burn Funding: 50 coins (VAR) - should be excluded from Received and Balance
	txHash2 := []byte(fmt.Sprintf("txhash2%d", time.Now().UnixNano()))
	var voutID2 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 0, 0, $2, 0, 'nulldata') RETURNING id`, txHash2, 50).Scan(&voutID2)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`, address, txHash2, 50, voutID2)
	if err != nil {
		t.Fatal(err)
	}

	// 3. Regular Spending: 30 coins (VAR)
	txHash3 := []byte(fmt.Sprintf("txhash3%d", time.Now().UnixNano()))
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, false, $4, $5, true, now(), 0)`, address, txHash3, 30, txHash1, voutID1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`, txHash3, address, txHash1)
	if err != nil {
		t.Fatal(err)
	}

	// 3b. Change Output: 70 coins (VAR)
	var voutID3 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 1, 0, $2, 0, 'pkh') RETURNING id`, txHash3, 70).Scan(&voutID3)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`, address, txHash3, 70, voutID3)
	if err != nil {
		t.Fatal(err)
	}

	// 4. SKA Funding: 1000 coins (SKA1)
	txHashS1 := []byte(fmt.Sprintf("txhashS1%d", time.Now().UnixNano()))
	var voutIDS1 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, ska_value, script_type) VALUES ($1, 0, 0, 0, 1, '1000', 'pkh') RETURNING id`, txHashS1).Scan(&voutIDS1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type, ska_value) VALUES ($1, $2, 0, 1, true, $3, true, now(), 0, '1000')`, address, txHashS1, voutIDS1)
	if err != nil {
		t.Fatal(err)
	}

	// 5. SKA Spending: 400 coins (SKA1)
	txHashS2 := []byte(fmt.Sprintf("txhashS2%d", time.Now().UnixNano()))
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type, ska_value) VALUES ($1, $2, 0, 1, false, $3, $4, true, now(), 0, '')`, address, txHashS2, txHashS1, voutIDS1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`, txHashS2, address, txHashS1)
	if err != nil {
		t.Fatal(err)
	}

	// 5b. SKA Change: 600 coins (SKA1)
	var voutIDS2 uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, ska_value, script_type) VALUES ($1, 1, 0, 0, 1, '600', 'pkh') RETURNING id`, txHashS2).Scan(&voutIDS2)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type, ska_value) VALUES ($1, $2, 0, 1, true, $3, true, now(), 0, '600')`, address, txHashS2, voutIDS2)
	if err != nil {
		t.Fatal(err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	// No defer delete here, we'll do it at the end.


	bal, err := retrieveAddressBalance(ctx, sqlDb, address)
	if err != nil {
		t.Fatalf("retrieveAddressBalance failed: %v", err)
	}

	// VAR check
	cbVAR, ok := bal.Coins[0]
	if !ok {
		t.Fatal("Coin 0 balance not found")
	}
	if cbVAR.TotalUnspent != 70 {
		t.Errorf("VAR Expected TotalUnspent 70, got %d", cbVAR.TotalUnspent)
	}
	if cbVAR.TotalSpent != 100 {
		t.Errorf("VAR Expected TotalSpent 100, got %d", cbVAR.TotalSpent)
	}
	if cbVAR.TotalReceived != 170 {
		t.Errorf("VAR Expected TotalReceived 170, got %d", cbVAR.TotalReceived)
	}

	// SKA1 check
	cbSKA, ok := bal.Coins[1]
	if !ok {
		t.Fatal("Coin 1 balance not found")
	}
	if cbSKA.TotalUnspentSKA != "600" {
		t.Errorf("SKA1 Expected TotalUnspentSKA 600, got %s", cbSKA.TotalUnspentSKA)
	}
	if cbSKA.TotalReceivedSKA != "1600" {
		t.Errorf("SKA1 Expected TotalReceivedSKA 1600, got %s", cbSKA.TotalReceivedSKA)
	}
	if cbSKA.TotalSpentSKA != "1000" {
		t.Errorf("SKA1 Expected TotalSpentSKA 1000, got %s", cbSKA.TotalSpentSKA)
	}
}
