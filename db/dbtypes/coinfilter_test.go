package dbtypes

import "testing"

// TestMergedRowsPreserveCoinAndSKA guards the address-page bug where selecting a
// merged view (e.g. "Merged debits") with a SKA coin still rendered "VAR" in the
// Coin column and a zero amount. Merging dropped CoinType and the SKA atom value
// because AddressRowMerged carried neither, so every merged row defaulted to
// CoinType 0 (VAR) with an empty SKA string. Merging by tx hash never mixes
// coins (a transaction is single-coin), so a merged row must carry the coin type
// of its constituents and the summed SKA atoms.
func TestMergedRowsPreserveCoinAndSKA(t *testing.T) {
	const skaCoin uint8 = 1

	// Two SKA1 debit rows in the same transaction; merging must sum the SKA
	// atoms and keep CoinType == skaCoin.
	var txHash ChainHash
	txHash[0] = 0xab
	rows := []*AddressRow{
		{
			Address:        "Dtest",
			ValidMainChain: true,
			IsFunding:      false,
			TxHash:         txHash,
			TxVinVoutIndex: 0,
			Value:          0, // SKA value is not carried in the VAR int64 column
			CoinType:       skaCoin,
			SKAValue:       "1000000000000000000", // 1 SKA1 (1e18 atoms)
		},
		{
			Address:        "Dtest",
			ValidMainChain: true,
			IsFunding:      false,
			TxHash:         txHash,
			TxVinVoutIndex: 1,
			Value:          0,
			CoinType:       skaCoin,
			SKAValue:       "2000000000000000000", // 2 SKA1
		},
	}

	merged, err := SliceAddressRows(rows, 10, 0, AddrMergedTxnDebit)
	if err != nil {
		t.Fatalf("SliceAddressRows merged-debit failed: %v", err)
	}
	if len(merged) != 1 {
		t.Fatalf("expected 1 merged row, got %d", len(merged))
	}
	got := merged[0]
	if got.CoinType != skaCoin {
		t.Fatalf("merged row CoinType = %d, want %d (Coin column would render VAR)",
			got.CoinType, skaCoin)
	}
	if got.SKAValue != "3000000000000000000" {
		t.Fatalf("merged row SKAValue = %q, want %q (summed SKA atoms)",
			got.SKAValue, "3000000000000000000")
	}
	if got.IsFunding { // debit: net is a spend, so IsFunding must be false
		t.Fatalf("merged SKA debit row IsFunding = true, want false")
	}

	// VAR merged rows must keep working: CoinType 0, value summed in Value.
	var varHash ChainHash
	varHash[0] = 0xcd
	varRows := []*AddressRow{
		{Address: "Dtest", ValidMainChain: true, IsFunding: false, TxHash: varHash, Value: 100, CoinType: 0},
		{Address: "Dtest", ValidMainChain: true, IsFunding: false, TxHash: varHash, Value: 250, CoinType: 0},
	}
	mergedVAR, err := SliceAddressRows(varRows, 10, 0, AddrMergedTxnDebit)
	if err != nil {
		t.Fatalf("SliceAddressRows merged-debit (VAR) failed: %v", err)
	}
	if len(mergedVAR) != 1 {
		t.Fatalf("expected 1 merged VAR row, got %d", len(mergedVAR))
	}
	if mergedVAR[0].CoinType != 0 {
		t.Fatalf("merged VAR row CoinType = %d, want 0", mergedVAR[0].CoinType)
	}
	if mergedVAR[0].Value != 350 {
		t.Fatalf("merged VAR row Value = %d, want 350", mergedVAR[0].Value)
	}
	if mergedVAR[0].SKAValue != "" {
		t.Fatalf("merged VAR row SKAValue = %q, want empty", mergedVAR[0].SKAValue)
	}
}

// TestMergedCompactMixedCoins covers the all-coins ("Coin: All") merged path
// that flows through MergeRowsCompactRange (the row-cache entry point). VAR and
// SKA transactions in one merged result must each retain their own coin type
// and value rather than collapsing every row to VAR.
func TestMergedCompactMixedCoins(t *testing.T) {
	var varHash, skaHash ChainHash
	varHash[0] = 0x01
	skaHash[0] = 0x02
	rows := []*AddressRowCompact{
		{Address: "Dtest", ValidMainChain: true, IsFunding: true, TxHash: varHash, Value: 500, CoinType: 0},
		{Address: "Dtest", ValidMainChain: true, IsFunding: true, TxHash: skaHash, CoinType: 2, SKAValue: "7000000000000000000"},
	}

	merged := MergeRowsCompactRange(rows, 10, 0, AddrMergedTxn)
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged rows, got %d", len(merged))
	}
	byCoin := map[uint8]*AddressRowMerged{}
	for _, m := range merged {
		byCoin[m.CoinType] = m
	}
	v, ok := byCoin[0]
	if !ok {
		t.Fatalf("VAR merged row missing; coin types present: %v", byCoin)
	}
	if v.Value() != 500 || v.SKAValueStr() != "" {
		t.Fatalf("VAR merged row: Value=%d SKAValueStr=%q, want 500 and empty",
			v.Value(), v.SKAValueStr())
	}
	s, ok := byCoin[2]
	if !ok {
		t.Fatalf("SKA2 merged row missing; coin types present: %v", byCoin)
	}
	if s.SKAValueStr() != "7000000000000000000" {
		t.Fatalf("SKA2 merged row SKAValueStr=%q, want 7000000000000000000", s.SKAValueStr())
	}
	if !s.IsFunding() {
		t.Fatalf("SKA2 merged credit row IsFunding()=false, want true")
	}
}

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
