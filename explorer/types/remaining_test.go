package types

import "testing"

func TestRemainingWindowText(t *testing.T) {
	const sec = int64(1_000_000_000) // one second in nanoseconds
	tests := []struct {
		name      string
		idx       int
		max       int64
		blockTime int64
		want      string
	}{
		{"imminent at end of window", 144, 144, 60 * sec, "imminent"},
		{"one block left rounds to one minute", 143, 144, 60 * sec, "1m remaining"},
		{"seconds only", 0, 5, sec, "5s remaining"},
		{"all units", 0, 788645, sec, "1w 2d 3h 4m 5s remaining"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := RemainingWindowText(tc.idx, tc.max, tc.blockTime)
			if got != tc.want {
				t.Errorf("RemainingWindowText(%d, %d, %d) = %q, want %q",
					tc.idx, tc.max, tc.blockTime, got, tc.want)
			}
		})
	}
}
