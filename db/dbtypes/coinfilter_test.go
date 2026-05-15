package dbtypes

import "testing"

// filterByCoin returns only the rows matching coinType, preserving order.
func filterByCoin(rows []*AddressRow, coinType uint8) []*AddressRow {
	out := make([]*AddressRow, 0, len(rows))
	for _, r := range rows {
		if r.CoinType == coinType {
			out = append(out, r)
		}
	}
	return out
}

// mixedCoinRows builds a deterministic row set that is mostly VAR (coin 0)
// with the SKA1 (coin 1) rows at the tail — the shape that exposes the
// "filter after pagination" bug.
func mixedCoinRows() []*AddressRow {
	rows := make([]*AddressRow, 0, 10)
	for i := 0; i < 10; i++ {
		var h ChainHash
		h[0] = byte(i)
		ct := uint8(0)
		if i >= 8 { // last two rows are SKA1
			ct = 1
		}
		rows = append(rows, &AddressRow{
			Address:        "Dtest",
			ValidMainChain: true,
			IsFunding:      i%2 == 0,
			TxHash:         h,
			TxVinVoutIndex: uint32(i),
			CoinType:       ct,
		})
	}
	return rows
}

// TestCoinTypeAllSentinel guards the sentinel the original one-line balance
// fix relies on: CoinTypeAll must be a reserved value that no real coin index
// can take, otherwise "all coins" would silently collapse to a single coin.
func TestCoinTypeAllSentinel(t *testing.T) {
	if CoinTypeAll != 255 {
		t.Fatalf("CoinTypeAll changed to %d; the all-coins sentinel must stay 255 "+
			"and remain distinct from every real coin index", CoinTypeAll)
	}
	for ct := 0; ct < 255; ct++ {
		if uint8(ct) == CoinTypeAll {
			t.Fatalf("real coin index %d collides with CoinTypeAll", ct)
		}
	}
}

// TestCoinFilterBeforePagination is a regression test for the address-page
// coin filter. Coin filtering MUST be applied before LIMIT/OFFSET pagination.
// If it is applied after (filter a single already-paginated page), pages come
// back under-filled and rows of the selected coin become unreachable even
// though the per-coin count says they exist. This codifies why AddressHistory
// restricts to the coin before SliceAddressRows.
func TestCoinFilterBeforePagination(t *testing.T) {
	const skaCoin uint8 = 1
	const pageSize = 3

	rows := mixedCoinRows()
	wantSKA := filterByCoin(rows, skaCoin) // ground truth: 2 rows
	if len(wantSKA) != 2 {
		t.Fatalf("fixture sanity: expected 2 SKA1 rows, got %d", len(wantSKA))
	}

	// Correct order: filter to the coin, THEN paginate. The first page must
	// contain all SKA1 rows since pageSize >= number of SKA1 rows.
	correctPage0, err := SliceAddressRows(filterByCoin(rows, skaCoin), pageSize, 0, AddrTxnAll)
	if err != nil {
		t.Fatalf("SliceAddressRows (correct order) failed: %v", err)
	}
	if len(correctPage0) != len(wantSKA) {
		t.Fatalf("filter-before-paginate: page 0 should hold all %d SKA1 rows, got %d",
			len(wantSKA), len(correctPage0))
	}
	for _, r := range correctPage0 {
		if r.CoinType != skaCoin {
			t.Fatalf("filter-before-paginate returned a non-SKA1 row (coin %d)", r.CoinType)
		}
	}

	// Buggy order: paginate the full mixed set first, THEN filter that page.
	// Because the SKA1 rows fall outside the first page, page 0 yields none —
	// the defect this test guards against.
	page0Mixed, err := SliceAddressRows(rows, pageSize, 0, AddrTxnAll)
	if err != nil {
		t.Fatalf("SliceAddressRows (buggy order) failed: %v", err)
	}
	buggyPage0 := filterByCoin(page0Mixed, skaCoin)
	if len(buggyPage0) >= len(wantSKA) {
		t.Fatalf("test no longer demonstrates the bug: filter-after-paginate "+
			"returned %d/%d SKA1 rows on page 0", len(buggyPage0), len(wantSKA))
	}

	// And confirm the rows really are unreachable on the first page with the
	// buggy order, while the correct order surfaces them immediately.
	if len(buggyPage0) != 0 {
		t.Fatalf("expected 0 SKA1 rows on buggy page 0, got %d", len(buggyPage0))
	}
}
