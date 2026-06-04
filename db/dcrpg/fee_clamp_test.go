package dcrpg

import (
	"math"
	"testing"
)

// TestClampNonNegativeFee pins the appendBlockFees invariant from issue #405:
// per-block fee totals from SelectFeesPerBlockAboveHeight are non-negative (the
// negative-fee coinbase and votes/stakebase are excluded by the query's
// FILTER). A negative value is a data anomaly that must be clamped to 0 — not
// abs()'d into a misleading spike, and not turned into an error that would abort
// the whole charts update mid-pipeline and desync the block series. ok reports
// whether the value was already valid so the caller can warn on anomalies.
func TestClampNonNegativeFee(t *testing.T) {
	tests := []struct {
		name   string
		in     int64
		want   uint64
		wantOK bool
	}{
		{"positive passes through", 19500, 19500, true},
		{"zero passes through", 0, 0, true},
		{"max int64 passes through", math.MaxInt64, math.MaxInt64, true},
		{"negative clamps to zero and flags anomaly", -19500, 0, false},
		{"min int64 clamps to zero (no wrap)", math.MinInt64, 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := clampNonNegativeFee(tc.in)
			if got != tc.want || ok != tc.wantOK {
				t.Errorf("clampNonNegativeFee(%d) = (%d, %v), want (%d, %v)",
					tc.in, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}
