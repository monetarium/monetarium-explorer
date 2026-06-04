package cache

import (
	"reflect"
	"testing"
)

// TestAggregateSKAFees pins the daily-bin aggregation behind the per-coin SKA
// fee chart (issue #405 follow-on). The function groups per-block fees into UTC
// days, summing values within each day. The summation MUST use big.Int: SKA
// uses 18 decimals, so a single block's atoms already exceed int64, and a day's
// sum exceeds uint64 — any float64/int64 path would silently lose precision.
// Bins are emitted ordered by ascending day; each bin's timestamp is the start
// of its UTC day and its height is the first block observed for that day.
func TestAggregateSKAFees(t *testing.T) {
	const day = int64(86400)

	tests := []struct {
		name       string
		timestamps []int64
		heights    []int64
		values     []string
		wantTimes  []int64
		wantHeight []int64
		wantValues []string
	}{
		{
			name: "empty input yields nil",
		},
		{
			// Two blocks land in day 1, one in day 2. The day-1 sum
			// (1e19 + (2e19+1)) overflows uint64; the day-2 value overflows
			// every fixed-width integer — both must survive exactly.
			name:       "big-int sums across two days",
			timestamps: []int64{90000, 100000, 180000},
			heights:    []int64{10, 11, 20},
			values: []string{
				"10000000000000000000", // 1e19  (> int64 max)
				"20000000000000000001", // 2e19+1 (> uint64 max)
				"123456789012345678901234567890",
			},
			wantTimes:  []int64{day, 2 * day}, // 86400, 172800
			wantHeight: []int64{10, 20},       // first block per day
			wantValues: []string{
				"30000000000000000001", // exact 1e19 + (2e19+1)
				"123456789012345678901234567890",
			},
		},
		{
			// An unparseable value is skipped without aborting the day or
			// corrupting the running sum; the bin height stays that of the
			// first VALID block seen for the day.
			name:       "skips unparseable value",
			timestamps: []int64{90000, 95000, 100000},
			heights:    []int64{10, 11, 12},
			values:     []string{"5", "not-a-number", "7"},
			wantTimes:  []int64{day},
			wantHeight: []int64{10},
			wantValues: []string{"12"},
		},
		{
			// Defensive: a values slice shorter than timestamps must not panic;
			// the unmatched trailing index is skipped.
			name:       "tolerates short values slice",
			timestamps: []int64{90000, 100000},
			heights:    []int64{10, 11},
			values:     []string{"42"},
			wantTimes:  []int64{day},
			wantHeight: []int64{10},
			wantValues: []string{"42"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotTimes, gotHeights, gotValues := aggregateSKAFees(tc.timestamps, tc.heights, tc.values)
			if !reflect.DeepEqual(gotTimes, tc.wantTimes) {
				t.Errorf("timestamps = %v, want %v", gotTimes, tc.wantTimes)
			}
			if !reflect.DeepEqual(gotHeights, tc.wantHeight) {
				t.Errorf("heights = %v, want %v", gotHeights, tc.wantHeight)
			}
			if !reflect.DeepEqual(gotValues, tc.wantValues) {
				t.Errorf("values = %v, want %v", gotValues, tc.wantValues)
			}
		})
	}
}
