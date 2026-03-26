package explorer

import (
	"testing"

	"github.com/decred/dcrdata/v8/explorer/types"
	"pgregory.net/rapid"
)

// --- Unit tests for buildHomeBlockRows (subtask 10.1) ---

// TestBuildHomeBlockRows_FieldPreservation verifies that all Overview fields
// from a known BlockBasic are copied exactly into the resulting HomeBlockRow.
// Requirements: 1.1, 4.2
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

// TestBuildHomeBlockRows_NilSkipping verifies that nil entries in the input
// slice are skipped without panicking and the result has the correct length.
// Requirements: 1.2
func TestBuildHomeBlockRows_NilSkipping(t *testing.T) {
	b := &types.BlockBasic{Height: 1, Hash: "abc"}
	input := []*types.BlockBasic{nil, b, nil}

	rows := buildHomeBlockRows(input)

	if len(rows) != 1 {
		t.Errorf("expected 1 row after skipping nils, got %d", len(rows))
	}
	if rows[0].Height != b.Height {
		t.Errorf("expected Height %d, got %d", b.Height, rows[0].Height)
	}
}

// TestBuildHomeBlockRows_AllNils verifies that an all-nil slice returns an
// empty result without panicking.
func TestBuildHomeBlockRows_AllNils(t *testing.T) {
	rows := buildHomeBlockRows([]*types.BlockBasic{nil, nil, nil})
	if len(rows) != 0 {
		t.Errorf("expected 0 rows, got %d", len(rows))
	}
}

// TestBuildHomeBlockRows_EmptySlice verifies that an empty input returns an
// empty result.
func TestBuildHomeBlockRows_EmptySlice(t *testing.T) {
	rows := buildHomeBlockRows([]*types.BlockBasic{})
	if len(rows) != 0 {
		t.Errorf("expected 0 rows, got %d", len(rows))
	}
}

// TestBuildHomeBlockRows_HasSKAData verifies that HasSKAData is true when
// sub-rows are non-empty and false when empty.
// Requirements: 1.2, 4.2
func TestBuildHomeBlockRows_HasSKAData(t *testing.T) {
	// height % 9 != 0 → sub-rows present → HasSKAData should be true
	bWithSKA := &types.BlockBasic{Height: 1}
	rowsWithSKA := buildHomeBlockRows([]*types.BlockBasic{bWithSKA})
	if len(rowsWithSKA) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rowsWithSKA))
	}
	if !rowsWithSKA[0].HasSKAData {
		t.Errorf("expected HasSKAData=true for height=1 (has sub-rows), got false")
	}
	if len(rowsWithSKA[0].SKASubRows) == 0 {
		t.Errorf("expected non-empty SKASubRows for height=1")
	}

	// height % 9 == 0 → no sub-rows → HasSKAData should be false
	bNoSKA := &types.BlockBasic{Height: 9}
	rowsNoSKA := buildHomeBlockRows([]*types.BlockBasic{bNoSKA})
	if len(rowsNoSKA) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rowsNoSKA))
	}
	if rowsNoSKA[0].HasSKAData {
		t.Errorf("expected HasSKAData=false for height=9 (no sub-rows), got true")
	}
	if len(rowsNoSKA[0].SKASubRows) != 0 {
		t.Errorf("expected empty SKASubRows for height=9, got %d", len(rowsNoSKA[0].SKASubRows))
	}
}

// TestBuildHomeBlockRows_SKASubRowTokenTypeNonEmpty verifies that every
// SKASubRow.TokenType is non-empty for any block that has HasSKAData = true.
// Requirements: 5.5
func TestBuildHomeBlockRows_SKASubRowTokenTypeNonEmpty(t *testing.T) {
	// Use a range of heights to cover both SKA-present and SKA-absent cases.
	for height := int64(0); height <= 20; height++ {
		rows := buildHomeBlockRows([]*types.BlockBasic{{Height: height}})
		if len(rows) != 1 {
			t.Fatalf("height=%d: expected 1 row, got %d", height, len(rows))
		}
		r := rows[0]
		if !r.HasSKAData {
			continue
		}
		for i, sub := range r.SKASubRows {
			if sub.TokenType == "" {
				t.Errorf("height=%d sub-row[%d]: TokenType is empty", height, i)
			}
		}
	}
}

// --- Property-based tests (optional subtasks 10.2, 10.3) ---

// Feature: home-block-table-redesign, Property 1: BlockBasic to HomeBlockRow field preservation
// Validates: Requirements 1.1, 4.2
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

// Feature: home-block-table-redesign, Property 3: Monetary fields are pre-formatted
// Validates: Requirements 1.4, 2.3, 4.3, 4.4
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
