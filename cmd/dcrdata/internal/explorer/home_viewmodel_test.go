package explorer

import (
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"pgregory.net/rapid"
)

// --- Unit tests for buildHomeBlockRows ---

// TestBuildHomeBlockRows_FieldPreservation verifies that all Overview fields
// from a known BlockBasic are copied exactly into the resulting HomeBlockRow.
func TestBuildHomeBlockRows_FieldPreservation(t *testing.T) {
	b := &types.BlockBasic{
		Height:         123456,
		Hash:           "abcdef1234567890",
		Transactions:   42,
		Voters:         5,
		FreshStake:     3,
		Revocations:    1,
		FormattedBytes: "12.3 kB",
		Total:          1250.5,
	}

	rows := buildHomeBlockRows([]*types.BlockBasic{b})

	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	r := rows[0]

	if r.Height != b.Height {
		t.Errorf("Height: got %d, want %d", r.Height, b.Height)
	}
	if r.Hash != b.Hash {
		t.Errorf("Hash: got %q, want %q", r.Hash, b.Hash)
	}
	if r.Transactions != b.Transactions {
		t.Errorf("Transactions: got %d, want %d", r.Transactions, b.Transactions)
	}
	if r.Voters != b.Voters {
		t.Errorf("Voters: got %d, want %d", r.Voters, b.Voters)
	}
	if r.FreshStake != b.FreshStake {
		t.Errorf("FreshStake: got %d, want %d", r.FreshStake, b.FreshStake)
	}
	if r.Revocations != b.Revocations {
		t.Errorf("Revocations: got %d, want %d", r.Revocations, b.Revocations)
	}
	if r.FormattedBytes != b.FormattedBytes {
		t.Errorf("FormattedBytes: got %q, want %q", r.FormattedBytes, b.FormattedBytes)
	}
	if r.BlockTime != b.BlockTime {
		t.Errorf("BlockTime: got %v, want %v", r.BlockTime, b.BlockTime)
	}
}

// TestBuildHomeBlockRows_NilSkipping verifies that nil entries are skipped.
func TestBuildHomeBlockRows_NilSkipping(t *testing.T) {
	b := &types.BlockBasic{Height: 1, Hash: "abc"}
	rows := buildHomeBlockRows([]*types.BlockBasic{nil, b, nil})

	if len(rows) != 1 {
		t.Errorf("expected 1 row after skipping nils, got %d", len(rows))
	}
	if rows[0].Height != b.Height {
		t.Errorf("expected Height %d, got %d", b.Height, rows[0].Height)
	}
}

// TestBuildHomeBlockRows_AllNils verifies that an all-nil slice returns empty.
func TestBuildHomeBlockRows_AllNils(t *testing.T) {
	rows := buildHomeBlockRows([]*types.BlockBasic{nil, nil, nil})
	if len(rows) != 0 {
		t.Errorf("expected 0 rows, got %d", len(rows))
	}
}

// TestBuildHomeBlockRows_EmptySlice verifies that an empty input returns empty.
func TestBuildHomeBlockRows_EmptySlice(t *testing.T) {
	rows := buildHomeBlockRows([]*types.BlockBasic{})
	if len(rows) != 0 {
		t.Errorf("expected 0 rows, got %d", len(rows))
	}
}

// TestBuildHomeBlockRows_VAROnly verifies that a block with no CoinRows falls
// back to Total for VARAmount and has no SKA sub-rows.
func TestBuildHomeBlockRows_VAROnly(t *testing.T) {
	b := &types.BlockBasic{
		Height:         10,
		Transactions:   5,
		FormattedBytes: "1.2 kB",
		Total:          500.0,
	}
	rows := buildHomeBlockRows([]*types.BlockBasic{b})
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	r := rows[0]
	if r.VARAmount != threeSigFigs(b.Total) {
		t.Errorf("VARAmount: got %q, want %q", r.VARAmount, threeSigFigs(b.Total))
	}
	if r.VARTxCount != b.Transactions {
		t.Errorf("VARTxCount: got %d, want %d", r.VARTxCount, b.Transactions)
	}
	if len(r.SKASubRows) != 0 {
		t.Errorf("expected no SKASubRows for VAR-only block, got %d", len(r.SKASubRows))
	}
	if r.SKAAmount != "" {
		t.Errorf("expected empty SKAAmount for VAR-only block, got %q", r.SKAAmount)
	}
	if r.SKAActiveSubRows != 0 {
		t.Errorf("expected SKAActiveSubRows == 0 for VAR-only block, got %d", r.SKAActiveSubRows)
	}
}

// TestBuildHomeBlockRows_WithCoinRows verifies that CoinRows atom strings are
// formatted via threeSigFigs for both VAR and SKA fields.
func TestBuildHomeBlockRows_WithCoinRows(t *testing.T) {
	b := &types.BlockBasic{
		Height:       20,
		Transactions: 7,
		CoinRows: []types.CoinRowData{
			// 1 230 000 000 VAR atoms = 12.3 VAR coins (8 decimals)
			{CoinType: 0, Symbol: "VAR", TxCount: 5, Amount: "1230000000", Size: 1024},
			// 1 230 000 000 000 000 000 SKA atoms = 1.23 SKA coins (18 decimals)
			{CoinType: 1, Symbol: "SKA1", TxCount: 2, Amount: "1230000000000000000", Size: 512},
		},
	}
	rows := buildHomeBlockRows([]*types.BlockBasic{b})
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	r := rows[0]

	if r.VARTxCount != 5 {
		t.Errorf("VARTxCount: got %d, want 5", r.VARTxCount)
	}
	wantVAR := threeSigFigs(float64(1230000000) / 1e8) // "12.3"
	if r.VARAmount != wantVAR {
		t.Errorf("VARAmount: got %q, want %q", r.VARAmount, wantVAR)
	}
	if len(r.SKASubRows) != 1 {
		t.Fatalf("expected 1 SKASubRow, got %d", len(r.SKASubRows))
	}
	if r.SKASubRows[0].TokenType != "SKA1" {
		t.Errorf("SKASubRow TokenType: got %q, want %q", r.SKASubRows[0].TokenType, "SKA1")
	}
	wantSKA := threeSigFigs(skaCoinValue("1230000000000000000")) // "1.23"
	if r.SKASubRows[0].Amount != wantSKA {
		t.Errorf("SKASubRow Amount: got %q, want %q", r.SKASubRows[0].Amount, wantSKA)
	}
	// SKAAmount carries the raw atom string; formatSKAAmountCell renders it
	// in the template.
	if r.SKAAmount != "1230000000000000000" {
		t.Errorf("SKAAmount: got %q, want raw atom %q", r.SKAAmount, "1230000000000000000")
	}
}

// TestBuildHomeBlockRows_TransactionsSumsCoinRows verifies that when CoinRows
// are present, Transactions equals the sum of all per-coin TxCounts (VAR +
// all SKA types), not just the raw b.Transactions value.
func TestBuildHomeBlockRows_TransactionsSumsCoinRows(t *testing.T) {
	b := &types.BlockBasic{
		Height:       20,
		Transactions: 3, // regular-tree only — should NOT appear in the result
		CoinRows: []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", TxCount: 5, Amount: "1000000000", Size: 200},
			{CoinType: 1, Symbol: "SKA1", TxCount: 2, Amount: "1000000000000000000", Size: 100},
			{CoinType: 2, Symbol: "SKA2", TxCount: 4, Amount: "2000000000000000000", Size: 150},
		},
	}
	rows := buildHomeBlockRows([]*types.BlockBasic{b})
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	// 5 (VAR) + 2 (SKA1) + 4 (SKA2) = 11, not b.Transactions (3)
	if rows[0].Transactions != 11 {
		t.Errorf("Transactions: got %d, want 11 (sum of CoinRows)", rows[0].Transactions)
	}
}

// TestBuildHomeBlockRows_MultipleSKATypes verifies that multiple SKA types
// produce multiple sub-rows and that SKAAmount carries the first SKA row's
// raw atom amount. The template renders the count summary via
// formatSKAAmountCell, so the view model itself records only raw atoms.
func TestBuildHomeBlockRows_MultipleSKATypes(t *testing.T) {
	b := &types.BlockBasic{
		Height: 30,
		CoinRows: []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", TxCount: 3, Amount: "10000000000", Size: 200},
			{CoinType: 1, Symbol: "SKA1", TxCount: 1, Amount: "50000000000000000000", Size: 100},
			{CoinType: 2, Symbol: "SKA2", TxCount: 2, Amount: "75000000000000000000", Size: 150},
		},
	}
	rows := buildHomeBlockRows([]*types.BlockBasic{b})
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	r := rows[0]

	if len(r.SKASubRows) != 2 {
		t.Fatalf("expected 2 SKASubRows, got %d", len(r.SKASubRows))
	}
	if r.SKAAmount != "50000000000000000000" {
		t.Errorf("SKAAmount: got %q, want first SKA row's raw atoms %q",
			r.SKAAmount, "50000000000000000000")
	}
	if r.SKAActiveSubRows != 2 {
		t.Errorf("SKAActiveSubRows: got %d, want 2 (both SKA rows have TxCount > 0)",
			r.SKAActiveSubRows)
	}
}

// TestBuildHomeBlockRows_SKAActiveSubRows verifies that SKAActiveSubRows is
// the count of SKA sub-rows with TxCount > 0 — what the "Σ K" cell shows.
func TestBuildHomeBlockRows_SKAActiveSubRows(t *testing.T) {
	tests := []struct {
		name       string
		coinRows   []types.CoinRowData
		wantActive int
	}{
		{
			name: "two SKA, neither has txs",
			coinRows: []types.CoinRowData{
				{CoinType: 0, Symbol: "VAR", TxCount: 1, Amount: "1000000000", Size: 200},
				{CoinType: 1, Symbol: "SKA1", TxCount: 0, Amount: "0", Size: 0},
				{CoinType: 2, Symbol: "SKA2", TxCount: 0, Amount: "0", Size: 0},
			},
			wantActive: 0,
		},
		{
			name: "two SKA, only SKA2 has txs",
			coinRows: []types.CoinRowData{
				{CoinType: 0, Symbol: "VAR", TxCount: 1, Amount: "1000000000", Size: 200},
				{CoinType: 1, Symbol: "SKA1", TxCount: 0, Amount: "0", Size: 0},
				{CoinType: 2, Symbol: "SKA2", TxCount: 3, Amount: "5000000000000000000", Size: 150},
			},
			wantActive: 1,
		},
		{
			name: "five SKA, two have txs",
			coinRows: []types.CoinRowData{
				{CoinType: 1, Symbol: "SKA1", TxCount: 4, Amount: "1", Size: 1},
				{CoinType: 2, Symbol: "SKA2", TxCount: 0, Amount: "0", Size: 0},
				{CoinType: 3, Symbol: "SKA3", TxCount: 0, Amount: "0", Size: 0},
				{CoinType: 4, Symbol: "SKA4", TxCount: 7, Amount: "2", Size: 1},
				{CoinType: 5, Symbol: "SKA5", TxCount: 0, Amount: "0", Size: 0},
			},
			wantActive: 2,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := &types.BlockBasic{Height: 50, CoinRows: tt.coinRows}
			rows := buildHomeBlockRows([]*types.BlockBasic{b})
			if len(rows) != 1 {
				t.Fatalf("expected 1 row, got %d", len(rows))
			}
			if rows[0].SKAActiveSubRows != tt.wantActive {
				t.Errorf("SKAActiveSubRows: got %d, want %d",
					rows[0].SKAActiveSubRows, tt.wantActive)
			}
		})
	}
}

// TestBuildHomeBlockRows_SKASubRowTokenTypeNonEmpty verifies that every
// SKASubRow.TokenType is non-empty when CoinRows has SKA entries.
func TestBuildHomeBlockRows_SKASubRowTokenTypeNonEmpty(t *testing.T) {
	b := &types.BlockBasic{
		Height: 40,
		CoinRows: []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", Amount: "1000000000"},
			{CoinType: 1, Symbol: "SKA1", Amount: "1000000000000000000"},
			{CoinType: 3, Symbol: "SKA3", Amount: "2000000000000000000"},
		},
	}
	rows := buildHomeBlockRows([]*types.BlockBasic{b})
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	for i, sub := range rows[0].SKASubRows {
		if sub.TokenType == "" {
			t.Errorf("sub-row[%d]: TokenType is empty", i)
		}
	}
}

// --- Property-based tests ---

// TestProp_HomeBlockRowFieldPreservation verifies that Overview fields are
// always copied verbatim from BlockBasic to HomeBlockRow.
func TestProp_HomeBlockRowFieldPreservation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		b := &types.BlockBasic{
			Height:         rapid.Int64().Draw(t, "height"),
			Hash:           rapid.StringMatching(`[a-f0-9]{0,64}`).Draw(t, "hash"),
			Transactions:   rapid.IntRange(0, 10000).Draw(t, "txs"),
			Voters:         uint16(rapid.IntRange(0, 5).Draw(t, "voters")),
			FreshStake:     uint8(rapid.IntRange(0, 20).Draw(t, "freshStake")),
			Revocations:    uint32(rapid.IntRange(0, 100).Draw(t, "revocations")),
			FormattedBytes: rapid.StringOf(rapid.RuneFrom([]rune("0123456789. kMGB"))).Draw(t, "formattedBytes"),
		}
		rows := buildHomeBlockRows([]*types.BlockBasic{b})
		if len(rows) != 1 {
			t.Fatalf("expected 1 row, got %d", len(rows))
		}
		r := rows[0]
		if r.Height != b.Height {
			t.Errorf("Height mismatch: got %d, want %d", r.Height, b.Height)
		}
		if r.Hash != b.Hash {
			t.Errorf("Hash mismatch: got %q, want %q", r.Hash, b.Hash)
		}
		if r.Transactions != b.Transactions {
			t.Errorf("Transactions mismatch: got %d, want %d", r.Transactions, b.Transactions)
		}
		if r.Voters != b.Voters {
			t.Errorf("Voters mismatch: got %d, want %d", r.Voters, b.Voters)
		}
		if r.FreshStake != b.FreshStake {
			t.Errorf("FreshStake mismatch: got %d, want %d", r.FreshStake, b.FreshStake)
		}
		if r.Revocations != b.Revocations {
			t.Errorf("Revocations mismatch: got %d, want %d", r.Revocations, b.Revocations)
		}
		if r.FormattedBytes != b.FormattedBytes {
			t.Errorf("FormattedBytes mismatch: got %q, want %q", r.FormattedBytes, b.FormattedBytes)
		}
		if r.BlockTime != b.BlockTime {
			t.Errorf("BlockTime mismatch: got %v, want %v", r.BlockTime, b.BlockTime)
		}
	})
}

// TestFormatCoinAtoms verifies the adapter routes VAR and SKA atom strings
// to the correct divisor and formatter.
func TestFormatCoinAtoms(t *testing.T) {
	cases := []struct {
		atomStr  string
		coinType uint8
		want     string
	}{
		// VAR: 8 decimal places
		{"1000000000", 0, "10.0"}, // 10 VAR coins
		{"100000000", 0, "1.00"},  // 1 VAR coin
		{"0", 0, "0"},
		// SKA: 18 decimal places
		{"1000000000000000000", 1, "1.00"},     // 1 SKA coin, type 1
		{"1000000000000000000000", 2, "1.00k"}, // 1000 SKA coins, type 2
		{"0", 1, "0"},
	}
	for _, c := range cases {
		got := formatCoinAtoms(c.atomStr, c.coinType)
		if got != c.want {
			t.Errorf("formatCoinAtoms(%q, %d) = %q, want %q", c.atomStr, c.coinType, got, c.want)
		}
	}
}

// TestSkaCoinValue covers the canonical conversion cases for skaCoinValue.
func TestSkaCoinValue(t *testing.T) {
	cases := []struct {
		input string
		want  float64
	}{
		{"", 0},
		{"0", 0},
		{"notanumber", 0},
		{"1000000000000000000", 1.0},       // exactly 1 SKA coin
		{"1500000000000000000", 1.5},       // 1.5 SKA coins
		{"1000000000000000000000", 1000.0}, // 1 000 SKA coins (k range)
		{"1000000000000000000000000", 1e6}, // 1 M SKA coins
		{"500000000000000000", 0.5},        // sub-1: 0.5 coin
		{"100000000000000000", 0.1},        // sub-1: 0.1 coin
		{"1000000000000000", 0.001},        // sub-1: 0.001 coin
		{"1", 1e-18},                       // sub-1: single atom, smallest possible value
	}
	for _, c := range cases {
		got := skaCoinValue(c.input)
		if got != c.want {
			t.Errorf("skaCoinValue(%q) = %v, want %v", c.input, got, c.want)
		}
	}
}

// TestSkaCoinValue_ThreeSigFigs verifies that skaCoinValue feeds correctly into
// threeSigFigs for representative magnitudes.
func TestSkaCoinValue_ThreeSigFigs(t *testing.T) {
	cases := []struct {
		atoms string
		want  string
	}{
		{"1000000000000000000", "1.00"},           // 1 coin
		{"1230000000000000000", "1.23"},           // 1.23 coins
		{"1000000000000000000000", "1.00k"},       // 1 000 coins
		{"1000000000000000000000000", "1.00M"},    // 1 M coins
		{"1000000000000000000000000000", "1.00B"}, // 1 B coins
		{"500000000000000000", "0.500"},           // sub-1: 0.5 coin
		{"100000000000000000", "0.100"},           // sub-1: 0.1 coin
		{"1000000000000000", "0.00100"},           // sub-1: 0.001 coin
	}
	for _, c := range cases {
		got := threeSigFigs(skaCoinValue(c.atoms))
		if got != c.want {
			t.Errorf("threeSigFigs(skaCoinValue(%q)) = %q, want %q", c.atoms, got, c.want)
		}
	}
}

// when no CoinRows are present (VAR-only fallback path).
func TestProp_VARAmountPreFormatted(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		total := rapid.Float64Range(0, 1e9).Draw(t, "total")
		b := &types.BlockBasic{Total: total}
		rows := buildHomeBlockRows([]*types.BlockBasic{b})
		if len(rows) != 1 {
			t.Fatalf("expected 1 row, got %d", len(rows))
		}
		want := threeSigFigs(total)
		if rows[0].VARAmount != want {
			t.Errorf("VARAmount: got %q, want %q (total=%v)", rows[0].VARAmount, want, total)
		}
	})
}

// TestMempoolInfo_TotalFillRatio verifies that TotalFillRatio is accessible
// on MempoolInfo and propagates to TrimmedMempoolInfo via Trim().
func TestMempoolInfo_TotalFillRatio(t *testing.T) {
	m := &types.MempoolInfo{}
	m.TotalFillRatio = 0.75
	m.ActiveSKACount = 2

	trimmed := m.Trim(1e6)
	if trimmed.TotalFillRatio != 0.75 {
		t.Errorf("TotalFillRatio: got %v, want 0.75", trimmed.TotalFillRatio)
	}
	if trimmed.ActiveSKACount != 2 {
		t.Errorf("ActiveSKACount: got %d, want 2", trimmed.ActiveSKACount)
	}
}

// TestMempoolInfo_TotalFillRatio_Zero verifies zero values propagate correctly.
func TestMempoolInfo_TotalFillRatio_Zero(t *testing.T) {
	m := &types.MempoolInfo{}
	trimmed := m.Trim(1e6)
	if trimmed.TotalFillRatio != 0.0 {
		t.Errorf("TotalFillRatio: got %v, want 0.0", trimmed.TotalFillRatio)
	}
	if trimmed.ActiveSKACount != 0 {
		t.Errorf("ActiveSKACount: got %d, want 0", trimmed.ActiveSKACount)
	}
}

// TestProp_TotalFillRatioRoundTrip verifies TotalFillRatio survives Trim() unchanged.
func TestProp_TotalFillRatioRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		ratio := rapid.Float64Range(0, 2.0).Draw(t, "ratio")
		count := rapid.IntRange(0, 255).Draw(t, "count")
		m := &types.MempoolInfo{}
		m.TotalFillRatio = ratio
		m.ActiveSKACount = count
		trimmed := m.Trim(1e6)
		if trimmed.TotalFillRatio != ratio {
			t.Errorf("TotalFillRatio round-trip: got %v, want %v", trimmed.TotalFillRatio, ratio)
		}
		if trimmed.ActiveSKACount != count {
			t.Errorf("ActiveSKACount round-trip: got %d, want %d", trimmed.ActiveSKACount, count)
		}
	})
}
