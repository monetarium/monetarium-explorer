package explorer

import (
	// Imports for TestThreeSigFigs
	// "fmt"
	// "math"
	// "math/rand"
	// "time"

	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestTestNet3Name(t *testing.T) {
	netName := netName(chaincfg.TestNet3Params())
	if netName != testnetNetName {
		t.Errorf(`Net name not "%s": %s`, testnetNetName, netName)
	}
}

func TestMainNetName(t *testing.T) {
	netName := netName(chaincfg.MainNetParams())
	if netName != "Mainnet" {
		t.Errorf(`Net name not "Mainnet": %s`, netName)
	}
}

func TestSimNetName(t *testing.T) {
	netName := netName(chaincfg.SimNetParams())
	if netName != "Simnet" {
		t.Errorf(`Net name not "Simnet": %s`, netName)
	}
}

// func TestThreeSigFigs(t *testing.T) {
// ...
// }

// TestThreeSigFigs covers every threshold branch in threeSigFigs, walking from
// the largest values down to zero. Each case documents what the function
// actually produces so the output is self-describing.
func TestThreeSigFigs(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		// ---- large numbers ----
		// >= 1e11  → "%dB"   (rounds to nearest billion, no decimal)
		{1e11, "100B"},
		{2.5e11, "250B"},
		{1.999e11, "200B"},

		// >= 1e10  → "%.1fB"  (one decimal billion)
		{1e10, "10.0B"},
		{1.55e10, "15.5B"},
		{9.99e10, "99.9B"}, // stays in 1-decimal bracket, does not round up to next
		// >= 1e9   → "%.2fB"  (two decimal billion)
		{1e9, "1.00B"},
		{1.235e9, "1.24B"},
		{9.999e9, "10.00B"}, // stays in 2-decimal bracket, does not round up

		// >= 1e8   → "%dM"
		{1e8, "100M"},
		{4.5e8, "450M"},

		// >= 1e7   → "%.1fM"
		{1e7, "10.0M"},
		{1.55e7, "15.5M"},

		// >= 1e6   → "%.2fM"
		{1e6, "1.00M"},
		{1.235e6, "1.24M"},

		// >= 1e5   → "%dk"
		{1e5, "100k"},
		{4.5e5, "450k"},

		// >= 1e4   → "%.1fk"
		{1e4, "10.0k"},
		{1.55e4, "15.5k"},

		// >= 1e3   → "%.2fk"
		{1e3, "1.00k"},
		{1.235e3, "1.24k"},

		// ---- sub-thousand, >= 100 → "%d"
		{100, "100"},
		{456, "456"},
		{999, "999"},

		// ---- >= 10  → "%.1f"
		{10, "10.0"},
		{15.5, "15.5"},
		{99.9, "99.9"},

		// ---- >= 1   → "%.2f"
		{1, "1.00"},
		{1.23, "1.23"},
		{9.99, "9.99"},

		// ---- sub-1: VAR fees can be fractional coins (e.g. 0.001 VAR fee)
		// threeSigFigs handles these correctly down to ~0.00001.
		{0.5, "0.500"},
		{0.1, "0.100"},
		{0.01, "0.0100"},
		{0.001, "0.00100"},

		// ---- zero
		{0, "0"},
	}

	for _, c := range cases {
		got := threeSigFigs(c.in)
		if got != c.want {
			t.Errorf("threeSigFigs(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}
