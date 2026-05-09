package explorer

import (
	"strings"
	"testing"
)

// TestBuildDevIndicatorScenarios verifies that every fixture used by the
// /dev/indicators page produces non-nil mempool data with the expected
// CoinFillData fields populated. This is a low-fidelity smoke test — its main
// value is catching panics and obviously-broken fixtures, not asserting on
// exact pct values (those are covered by TestComputeCoinFills).
func TestBuildDevIndicatorScenarios(t *testing.T) {
	scenarios := buildDevIndicatorScenarios()
	if len(scenarios) == 0 {
		t.Fatal("expected at least one fixture")
	}
	for _, s := range scenarios {
		if s.Title == "" {
			t.Errorf("fixture missing Title: %+v", s)
		}
		if s.Mempool == nil {
			t.Errorf("fixture %q has nil Mempool", s.Title)
			continue
		}
		// CoinFills must always include at least the VAR placeholder.
		fills := s.Mempool.MempoolShort.CoinFills
		if len(fills) == 0 || fills[0].Symbol != "VAR" {
			t.Errorf("fixture %q: expected VAR-first CoinFills, got %+v", s.Title, fills)
		}
		// PctOfTC is unclamped — overflow scenarios legitimately exceed 100.
		// Just sanity-check it's non-negative and finite-ish.
		for _, f := range fills {
			if f.PctOfTC < 0 || f.PctOfTC > 1000 {
				t.Errorf("fixture %q: %s PctOfTC implausible: %f", s.Title, f.Symbol, f.PctOfTC)
			}
		}
	}

	// Sanity-check the regression fixture explicitly.
	var regression *devIndicatorScenario
	for i := range scenarios {
		if strings.Contains(scenarios[i].Title, "regression case") {
			regression = &scenarios[i]
			break
		}
	}
	if regression == nil {
		t.Fatal("regression fixture missing")
	}
	v := regression.Mempool.MempoolShort.CoinFills[0]
	if v.Symbol != "VAR" {
		t.Fatalf("regression fixture coin[0] should be VAR, got %s", v.Symbol)
	}
	if v.PctOfTC <= 10.0 {
		t.Errorf("regression fixture VAR PctOfTC should reflect 15%% block fill, got %f", v.PctOfTC)
	}
	if v.IsOverflow {
		t.Errorf("regression fixture VAR should not overflow at 15%%, got IsOverflow=true")
	}
}
