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

	// 1. Issuance: 1000 coins (VAR) — coinbase vout index 0 => TxTypeBlockRewardPoW
	txHashIss := []byte(fmt.Sprintf("txhashIss%d", time.Now().UnixNano()))
	var voutIDIss uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type) VALUES ($1, 0, 0, $2, 0, 'pkh') RETURNING id`, txHashIss, 1000).Scan(&voutIDIss)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, true, $4, true, now(), $5)`, address, txHashIss, 1000, voutIDIss, dbtypes.TxTypeBlockRewardPoW)
	if err != nil {
		t.Fatal(err)
	}
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

	// 5. Regular Spending: 100 coins (VAR) — uses the 100-VAR UTXO from txHash1
	txHash3 := []byte(fmt.Sprintf("txhash3%d", time.Now().UnixNano()))
	_, err = tx.Exec(`INSERT INTO addresses (address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type) VALUES ($1, $2, $3, 0, false, $4, $5, true, now(), 0)`, address, txHash3, 100, txHash1, voutID1)
	if err != nil {
		t.Fatal(err)
	}
	// Link the funding row back to the spending tx (as extraction.go does).
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`, txHash3, address, txHash1)
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

	// 7. SKA Spending (ska_value = '' on the address row, forcing SQL to fall through to v.ska_value)
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
		sqlDb.Exec(`DELETE FROM vouts WHERE tx_hash IN (SELECT tx_hash FROM addresses WHERE address = $1)`, address)
		sqlDb.Exec(`DELETE FROM vins WHERE tx_hash IN (SELECT tx_hash FROM addresses WHERE address = $1)`, address)
		sqlDb.Exec(`DELETE FROM addresses WHERE address = $1`, address)
	}()

	bal, err := retrieveAddressBalance(ctx, sqlDb, address)
	if err != nil {
		t.Fatalf("retrieveAddressBalance failed: %v", err)
	}

	cbVAR, ok := bal.Coins[0]
	if !ok {
		t.Fatal("Coin 0 balance not found")
	}

	// Totals
	//   Received: 1000(issuance) + 100(regular) + 50(PoS) + 20(PoW) + 1190(change) = 2360
	//   Spent: 100
	//   Unspent: 1000(issuance) + 50(PoS) + 20(PoW) + 1190(change) = 2260
	//   Received - Spent = 2360 - 100 = 2260 = Unspent ✓
	if cbVAR.TotalUnspent != 2260 {
		t.Errorf("VAR Expected TotalUnspent 2260, got %d", cbVAR.TotalUnspent)
	}
	if cbVAR.TotalSpent != 100 {
		t.Errorf("VAR Expected TotalSpent 100, got %d", cbVAR.TotalSpent)
	}
	if cbVAR.TotalReceived != 2360 {
		t.Errorf("VAR Expected TotalReceived 2360, got %d", cbVAR.TotalReceived)
	}

	// FromStake = 50 (PoS) / 150 (regular + PoS; PoW and coinbase are excluded)
	expectedRatio := 50.0 / 150.0
	if fmt.Sprintf("%.4f", cbVAR.FromStake) != fmt.Sprintf("%.4f", expectedRatio) {
		t.Errorf("VAR Expected FromStake %.4f, got %.4f", expectedRatio, cbVAR.FromStake)
	}
	if cbVAR.FromStake > 1.0 {
		t.Errorf("VAR FromStake %.4f > 1.0", cbVAR.FromStake)
	}

	cbSKA, okSKA := bal.Coins[1]
	if !okSKA {
		t.Fatal("Coin 1 balance not found")
	}

	// Totals
	//   Received: 1000(original) + 600(change) = 1600
	//   Spent: 1000 (full input, from v.ska_value via SQL fallback)
	//   Unspent: 600(change)
	//   Received - Spent = 1600 - 1000 = 600 = Unspent ✓
	if cbSKA.TotalUnspentSKA != "600" {
		t.Errorf("SKA1 Expected TotalUnspentSKA 600, got %s", cbSKA.TotalUnspentSKA)
	}
	if cbSKA.TotalReceivedSKA != "1600" {
		t.Errorf("SKA1 Expected TotalReceivedSKA 1600, got %s", cbSKA.TotalReceivedSKA)
	}
	if cbSKA.TotalSpentSKA != "1000" {
		t.Errorf("SKA1 Expected TotalSpentSKA 1000, got %s", cbSKA.TotalSpentSKA)
	}
	// Verify the skaSpent came from v.ska_value, not from a zero accumulator.
	if cbSKA.TotalSpentSKA == "0" {
		t.Error("SKA1 TotalSpentSKA is 0 — regression: spending row ska_value was lost (COALESCE/NULLIF fix missing)")
	}
}

func TestRetrieveAddressBalance_NulldataFundingAndMultiVin(t *testing.T) {
	// This tests both bugs that caused Spent > Received:
	//
	// Bug 1: The nulldata filter excluded funding rows with script_type='nulldata'
	//        from Received, but spending rows always passed unconditionally.
	//        Monetarium change outputs of regular transactions use script_type='nulldata'
	//        and carry non-zero value — they must count toward Received.
	//
	// Bug 2: The spending_txs CTE lacked DISTINCT. When a transaction spends multiple
	//        vouts from the same address, the CTE returns duplicate tx_hashes and the
	//        LEFT JOIN multiplies rows, inflating every SUM by the number of duplicates.

	ctx := context.Background()
	address := fmt.Sprintf("TestNulldataMultiVin%d", time.Now().UnixNano())

	tx, err := sqlDb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	// ---- Funding A: 100 VAR, script_type='pkh' (always counted) ----
	txHashA := []byte(fmt.Sprintf("txA_%d", time.Now().UnixNano()))
	var voutID_A uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type)
		VALUES ($1, 0, 0, 100, 0, 'pkh') RETURNING id`, txHashA).Scan(&voutID_A)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`,
		address, txHashA, 100, voutID_A)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type)
		VALUES ($1, 0, 0, $2, 0, 0, 100, 0, 0)`, txHashA, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// ---- Funding B: 150 VAR, script_type='pkh' (always counted) ----
	txHashB := []byte(fmt.Sprintf("txB_%d", time.Now().UnixNano()))
	var voutID_B uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type)
		VALUES ($1, 0, 0, 150, 0, 'pkh') RETURNING id`, txHashB).Scan(&voutID_B)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`,
		address, txHashB, 150, voutID_B)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type)
		VALUES ($1, 0, 0, $2, 0, 0, 150, 0, 0)`, txHashB, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// ---- Funding C: 300 VAR, script_type='nulldata' (FORMERLY excluded by filter) ----
	txHashC := []byte(fmt.Sprintf("txC_%d", time.Now().UnixNano()))
	var voutID_C uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type)
		VALUES ($1, 0, 0, 300, 0, 'nulldata') RETURNING id`, txHashC).Scan(&voutID_C)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`,
		address, txHashC, 300, voutID_C)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type)
		VALUES ($1, 0, 0, $2, 0, 0, 300, 0, 0)`, txHashC, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// ---- Multi-vin spending (Bug 2): txHashD spends BOTH Funding A AND Funding B ----
	// Two spending rows with the same tx_hash — without DISTINCT, CTE returns 2 rows
	// for txHashD, doubling all SUMs.
	txHashD := []byte(fmt.Sprintf("txD_%d", time.Now().UnixNano()))

	// Spending row 1: spends Funding A (100 VAR)
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, false, $4, $5, true, now(), 0)`,
		address, txHashD, 100, txHashA, voutID_A)
	if err != nil {
		t.Fatal(err)
	}
	// Spending row 2: spends Funding B (150 VAR) — same txHashD!
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, false, $4, $5, true, now(), 0)`,
		address, txHashD, 150, txHashB, voutID_B)
	if err != nil {
		t.Fatal(err)
	}

	// Mark funding A and B as spent.
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`,
		txHashD, address, txHashA)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`,
		txHashD, address, txHashB)
	if err != nil {
		t.Fatal(err)
	}

	// Change output from txHashD: 50 VAR back to address, script_type='pkh'.
	var voutID_D_change uint64
	err = tx.QueryRow(`INSERT INTO vouts (tx_hash, tx_index, tx_tree, value, coin_type, script_type)
		VALUES ($1, 1, 0, 50, 0, 'pkh') RETURNING id`, txHashD).Scan(&voutID_D_change)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, true, $4, true, now(), 0)`,
		address, txHashD, 50, voutID_D_change)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`INSERT INTO vins (tx_hash, tx_index, tx_tree, prev_tx_hash, prev_tx_index, prev_tx_tree, value_in, coin_type, tx_type)
		VALUES ($1, 0, 0, $2, 0, 0, 50, 0, 0)`, txHashD, []byte("notzero"))
	if err != nil {
		t.Fatal(err)
	}

	// ---- Single-vin spending (no CTE duplication): txHashE spends Funding C ----
	txHashE := []byte(fmt.Sprintf("txE_%d", time.Now().UnixNano()))
	_, err = tx.Exec(`INSERT INTO addresses
		(address, tx_hash, value, coin_type, is_funding, matching_tx_hash, tx_vin_vout_row_id, valid_mainchain, block_time, tx_type)
		VALUES ($1, $2, $3, 0, false, $4, $5, true, now(), 0)`,
		address, txHashE, 300, txHashC, voutID_C)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`UPDATE addresses SET matching_tx_hash = $1 WHERE address = $2 AND tx_hash = $3 AND is_funding = true`,
		txHashE, address, txHashC)
	if err != nil {
		t.Fatal(err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		sqlDb.Exec(`DELETE FROM vouts WHERE tx_hash IN (SELECT tx_hash FROM addresses WHERE address = $1)`, address)
		sqlDb.Exec(`DELETE FROM vins WHERE tx_hash IN (SELECT tx_hash FROM addresses WHERE address = $1)`, address)
		sqlDb.Exec(`DELETE FROM addresses WHERE address = $1`, address)
	}()

	bal, err := retrieveAddressBalance(ctx, sqlDb, address)
	if err != nil {
		t.Fatalf("retrieveAddressBalance failed: %v", err)
	}

	cbVAR, ok := bal.Coins[0]
	if !ok {
		t.Fatal("Coin 0 balance not found")
	}

	// ---- Expected values with BOTH fixes applied ----
	// Received: 100(A 'pkh') + 150(B 'pkh') + 300(C 'nulldata') + 50(change from D 'pkh') = 600
	// Spent:    txHashD(100+150=250 from multi-vin, no duplication) + txHashE(300) = 550
	// Unspent:  50(change from D, no matching_tx_hash)
	// Invariant: 600 - 550 = 50 ✓
	var wantUnspent int64 = 50
	var wantSpent int64 = 550
	var wantReceived int64 = 600

	if cbVAR.TotalUnspent != wantUnspent {
		t.Errorf("VAR TotalUnspent = %d, want %d", cbVAR.TotalUnspent, wantUnspent)
	}
	if cbVAR.TotalSpent != wantSpent {
		t.Errorf("VAR TotalSpent = %d, want %d (if %d, the CTE DISTINCT fix is missing)",
			cbVAR.TotalSpent, wantSpent, wantSpent*2)
	}
	if cbVAR.TotalReceived != wantReceived {
		t.Errorf("VAR TotalReceived = %d, want %d (if %d, the nulldata filter is still present)",
			cbVAR.TotalReceived, wantReceived, wantReceived-300)
	}

	// Verify the invariant holds.
	if cbVAR.TotalReceived-cbVAR.TotalSpent != cbVAR.TotalUnspent {
		t.Errorf("VAR invariant broken: Received(%d) - Spent(%d) = %d != Unspent(%d)",
			cbVAR.TotalReceived, cbVAR.TotalSpent,
			cbVAR.TotalReceived-cbVAR.TotalSpent, cbVAR.TotalUnspent)
	}
}
