//go:build pgonline || chartdata

package dcrpg

import (
	"context"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dcrpg/internal"
)

// TestSelectFeesPerBlockExcludesCoinbase is a regression test for issue #405:
// the Fees chart rendered zero for every mainnet block. The per-block query
// SUM(fees) GROUP BY block_height summed transactions.fees over *all* txs in a
// block, including the coinbase. A coinbase mints the block subsidy and emits
// the collected fees as outputs, so with fees = spent - sent its stored fee is
// negative and equal to -(sum of all real fees in the block). Summing it
// alongside the real (positive) fees cancels them to exactly zero.
//
// The Block# page header instead reports getTotalFee(block.Tx) +
// getTotalFee(block.Tickets) — regular-tree non-coinbase txs plus ticket
// purchases, excluding coinbase/votes/stake fees (pgblockchain.go). The chart
// must match that, so SelectFeesPerBlockAboveHeight must sum only that set.
//
// The test seeds one synthetic block into a session-local temp table that
// shadows the real transactions table, then runs the exact production query.
func TestSelectFeesPerBlockExcludesCoinbase(t *testing.T) {
	ctx := context.Background()

	// A transaction binds all statements to a single connection so the temp
	// table is visible to the query, and ON COMMIT DROP cleans it up even if
	// the test fails (we always Rollback).
	tx, err := sqlDb.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	defer tx.Rollback()

	mustExec := func(q string, args ...interface{}) {
		t.Helper()
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("exec failed: %v\nquery: %s", err, q)
		}
	}

	// Shadow the real transactions table with the columns the query touches.
	mustExec(`CREATE TEMP TABLE transactions (
		block_height INT8,
		tree         INT2,
		tx_type      INT2,
		block_index  INT4,
		fees         INT8,
		is_mainchain BOOLEAN
	) ON COMMIT DROP;`)

	// One mainchain block (height 100) mirroring real mainnet rows:
	//   - coinbase    (tree 0, index 0): fee = -(all collected fees)  <- the bug
	//   - regular tx  (tree 0, index 1): fee  13460
	//   - ticket buy  (tree 1, type 105): fee  3020
	//   - ticket buy  (tree 1, type 105): fee  3020
	// Block# header value = 13460 + 3020 + 3020 = 19500 atoms.
	const regularFee = 13460
	const ticketFee = 3020
	const realBlockFee = regularFee + 2*ticketFee // 19500
	mustExec(`INSERT INTO transactions
		(block_height, tree, tx_type, block_index, fees, is_mainchain) VALUES
		(100, 0,   0, 0, $1, TRUE),
		(100, 0,   0, 1, $2, TRUE),
		(100, 1, 105, 0, $3, TRUE),
		(100, 1, 105, 1, $3, TRUE);`,
		-realBlockFee, regularFee, ticketFee)

	// Guard the premise: the naive SUM(fees) cancels to exactly zero, which is
	// the symptom the chart exhibited. If this ever stops holding, the fix's
	// rationale (and this test) must be revisited.
	var naive int64
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(fees), 0) FROM transactions WHERE is_mainchain AND block_height > 0`,
	).Scan(&naive); err != nil {
		t.Fatalf("naive sum query: %v", err)
	}
	if naive != 0 {
		t.Fatalf("premise broken: expected naive SUM(fees)=0 (coinbase cancellation), got %d", naive)
	}

	// The production query must report the real per-block fee, not zero.
	rows, err := tx.QueryContext(ctx, internal.SelectFeesPerBlockAboveHeight, int64(0))
	if err != nil {
		t.Fatalf("SelectFeesPerBlockAboveHeight: %v", err)
	}
	defer rows.Close()

	var gotRows int
	var gotHeight uint64
	var gotFees int64
	for rows.Next() {
		gotRows++
		if err := rows.Scan(&gotHeight, &gotFees); err != nil {
			t.Fatalf("scan: %v", err)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows.Err: %v", err)
	}

	// One row per block must be returned (appendBlockFees aligns blocks.Fees to
	// block height by row order); the coinbase-only grouping must not drop it.
	if gotRows != 1 {
		t.Fatalf("expected exactly 1 block row, got %d", gotRows)
	}
	if gotHeight != 100 {
		t.Errorf("block_height: want 100, got %d", gotHeight)
	}
	if gotFees != realBlockFee {
		t.Errorf("issue #405: fees for block 100: want %d, got %d", realBlockFee, gotFees)
	}
}
