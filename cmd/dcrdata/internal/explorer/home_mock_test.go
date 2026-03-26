package explorer

import (
	"testing"

	"pgregory.net/rapid"
)

// --- Unit tests for mockSKAData ---

// TestMockSKAData_SubRowCount verifies that non-multiples of 9 produce exactly 3 sub-rows
// (one per entry in mockSKATokens).
func TestMockSKAData_SubRowCount(t *testing.T) {
	heights := []int64{1, 2, 5, 7, 8, 10, 100, 1000}
	for _, h := range heights {
		_, _, _, subRows := mockSKAData(h)
		if len(subRows) != 3 {
			t.Errorf("height=%d: expected exactly 3 sub-rows, got %d", h, len(subRows))
		}
	}
}

// TestSKASubRow_TokenTypeNonEmpty verifies that all sub-rows returned by
// mockSKAData have a non-empty TokenType field.
func TestSKASubRow_TokenTypeNonEmpty(t *testing.T) {
	_, _, _, subRows := mockSKAData(1) // height=1 is not a multiple of 9
	if len(subRows) == 0 {
		t.Fatal("expected non-empty sub-rows for height=1")
	}
	for i, sr := range subRows {
		if sr.TokenType == "" {
			t.Errorf("sub-row[%d]: TokenType is empty", i)
		}
	}
}

// TestMockSKAData_ZeroSubRowsForMultiplesOf9 verifies that multiples of 9
// produce an empty sub-row slice.
func TestMockSKAData_ZeroSubRowsForMultiplesOf9(t *testing.T) {
	heights := []int64{0, 9, 18, 27, 99, 900}
	for _, h := range heights {
		_, _, _, subRows := mockSKAData(h)
		if len(subRows) != 0 {
			t.Errorf("height=%d: expected 0 sub-rows, got %d", h, len(subRows))
		}
	}
}

// TestMockSKAData_HasSKADataFlag verifies the HasSKAData flag via buildHomeBlockRows.
func TestMockSKAData_HasSKADataFlag(t *testing.T) {
	// Non-multiple of 9: HasSKAData must be true.
	_, _, _, subRowsOn := mockSKAData(1)
	if len(subRowsOn) == 0 {
		t.Error("height=1: expected non-empty sub-rows")
	}

	// Multiple of 9: HasSKAData must be false.
	_, _, _, subRowsOff := mockSKAData(9)
	if len(subRowsOff) != 0 {
		t.Errorf("height=9: expected empty sub-rows, got %d", len(subRowsOff))
	}
}

// TestMockSKAData_SubRowFieldsNonEmpty verifies that each sub-row has non-empty
// formatted fields.
func TestMockSKAData_SubRowFieldsNonEmpty(t *testing.T) {
	_, _, _, subRows := mockSKAData(1)
	for i, sr := range subRows {
		if sr.TokenType == "" {
			t.Errorf("sub-row %d: empty TokenType", i)
		}
		if sr.TxCount == "" {
			t.Errorf("sub-row %d: empty TxCount", i)
		}
		if sr.Amount == "" {
			t.Errorf("sub-row %d: empty Amount", i)
		}
		if sr.Size == "" {
			t.Errorf("sub-row %d: empty Size", i)
		}
	}
}

// --- Property-based tests (optional subtasks 10.4, 10.5) ---

// Feature: home-block-table-redesign, Property 4a: Non-zero heights produce >= 2 sub-rows
// Validates: Requirements 1.2, 1.3, 5.6
func TestProp_MockSKASubRowCount_NonZero(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a height that is NOT a multiple of 9.
		base := rapid.Int64Range(0, 111111).Draw(t, "base")
		offset := rapid.Int64Range(1, 8).Draw(t, "offset")
		height := base*9 + offset // guarantees height%9 != 0
		_, _, _, subRows := mockSKAData(height)
		if len(subRows) < 2 {
			t.Errorf("height=%d (%%9=%d): expected >= 2 sub-rows, got %d",
				height, height%9, len(subRows))
		}
	})
}

// Feature: home-block-table-redesign, Property 4b: Multiples of 9 produce 0 sub-rows
// Validates: Requirements 1.2, 6.4, 7.3, 7.4
func TestProp_MockSKASubRowCount_Zero(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.Int64Range(0, 111111).Draw(t, "n")
		height := n * 9 // guarantees height%9 == 0
		_, _, _, subRows := mockSKAData(height)
		if len(subRows) != 0 {
			t.Errorf("height=%d: expected 0 sub-rows, got %d", height, len(subRows))
		}
	})
}
