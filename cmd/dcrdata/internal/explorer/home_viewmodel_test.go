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
}

// TestBuildHomeBlockRows_WithCoinRows verifies that CoinRows data is correctly
// mapped to VAR and SKA fields.
func TestBuildHomeBlockRows_WithCoinRows(t *testing.T) {
	b := &types.BlockBasic{
		Height:       20,
		Transactions: 7,
		CoinRows: []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", TxCount: 5, Amount: "1.23K VAR", Size: 1024},
			{CoinType: 1, Symbol: "SKA-1", TxCount: 2, Amount: "4.56M SKA-1", Size: 512},
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
	if r.VARAmount != "1.23K VAR" {
		t.Errorf("VARAmount: got %q, want %q", r.VARAmount, "1.23K VAR")
	}
	if len(r.SKASubRows) != 1 {
		t.Fatalf("expected 1 SKASubRow, got %d", len(r.SKASubRows))
	}
	if r.SKASubRows[0].TokenType != "SKA-1" {
		t.Errorf("SKASubRow TokenType: got %q, want %q", r.SKASubRows[0].TokenType, "SKA-1")
	}
	if r.SKASubRows[0].Amount != "4.56M SKA-1" {
		t.Errorf("SKASubRow Amount: got %q, want %q", r.SKASubRows[0].Amount, "4.56M SKA-1")
	}
	// Single SKA type: SKAAmount should equal the sub-row amount.
	if r.SKAAmount != "4.56M SKA-1" {
		t.Errorf("SKAAmount: got %q, want %q", r.SKAAmount, "4.56M SKA-1")
	}
}

// TestBuildHomeBlockRows_MultipleSKATypes verifies that multiple SKA types
// produce multiple sub-rows and a count summary in SKAAmount.
func TestBuildHomeBlockRows_MultipleSKATypes(t *testing.T) {
	b := &types.BlockBasic{
		Height: 30,
		CoinRows: []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", TxCount: 3, Amount: "100 VAR", Size: 200},
			{CoinType: 1, Symbol: "SKA-1", TxCount: 1, Amount: "50 SKA-1", Size: 100},
			{CoinType: 2, Symbol: "SKA-2", TxCount: 2, Amount: "75 SKA-2", Size: 150},
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
	// Multiple SKA types: SKAAmount should be a count summary.
	if r.SKAAmount != "2 SKA types" {
		t.Errorf("SKAAmount: got %q, want %q", r.SKAAmount, "2 SKA types")
	}
}

// TestBuildHomeBlockRows_SKASubRowTokenTypeNonEmpty verifies that every
// SKASubRow.TokenType is non-empty when CoinRows has SKA entries.
func TestBuildHomeBlockRows_SKASubRowTokenTypeNonEmpty(t *testing.T) {
	b := &types.BlockBasic{
		Height: 40,
		CoinRows: []types.CoinRowData{
			{CoinType: 0, Symbol: "VAR", Amount: "10 VAR"},
			{CoinType: 1, Symbol: "SKA-1", Amount: "20 SKA-1"},
			{CoinType: 3, Symbol: "SKA-3", Amount: "30 SKA-3"},
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

// TestProp_VARAmountPreFormatted verifies that VARAmount matches threeSigFigs
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
