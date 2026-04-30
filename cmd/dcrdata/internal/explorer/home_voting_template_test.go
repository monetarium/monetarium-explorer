package explorer

import (
	"fmt"
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
	"golang.org/x/net/html"
	"pgregory.net/rapid"
)

// votingCardPageData is the minimal page data struct required by the
// voting-card template. It mirrors the anonymous struct used in explorerroutes.go.
type votingCardPageData struct {
	*CommonPageData
	Info          *types.HomeInfo
	Conversions   interface{}
	PercentChange float64
}

// tHelper is a minimal interface satisfied by both *testing.T and *rapid.T.
type tHelper interface {
	Helper()
	Fatal(args ...interface{})
	Fatalf(format string, args ...interface{})
}

// newVotingCardTemplates loads only the templates needed to render voting-card.
func newVotingCardTemplates(t *testing.T) templates {
	t.Helper()
	funcMap := makeTemplateFuncMap(chaincfg.SimNetParams())
	funcMap["asset"] = func(name string) string { return "/dist/" + name }
	tmpl := newTemplates(viewsFolder, false, []string{"extras"}, funcMap)
	if err := tmpl.addTemplate("home_voting"); err != nil {
		t.Fatalf("addTemplate home_voting: %v", err)
	}
	return tmpl
}

// renderVotingCard renders the voting-card template with the given HomeInfo.
// It executes the "voting-card" named block directly from the home_voting template.
func renderVotingCard(t tHelper, tmpl templates, info *types.HomeInfo) string {
	t.Helper()
	data := &votingCardPageData{
		CommonPageData: &CommonPageData{Links: &links{}, Tip: &types.WebBasicBlock{}},
		Info:           info,
	}
	pt, ok := tmpl.templates["home_voting"]
	if !ok {
		t.Fatal("home_voting template not loaded")
	}
	var sb strings.Builder
	if err := pt.template.ExecuteTemplate(&sb, "voting-card", data); err != nil {
		t.Fatalf("template exec: %v", err)
	}
	return sb.String()
}

// makeHomeInfo builds a HomeInfo with the given VoteVARReward and SKAVoteRewards.
func makeHomeInfo(varReward types.VoteVARReward, skaRewards []types.SKAVoteReward) *types.HomeInfo {
	return &types.HomeInfo{
		VoteVARReward:  varReward,
		SKAVoteRewards: skaRewards,
	}
}

// TestVotingCardTemplate runs example-based sub-cases for the voting-card template.
func TestVotingCardTemplate(t *testing.T) {
	tmpl := newVotingCardTemplates(t)

	// Case 1 — Label check
	t.Run("LabelCheck", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, nil))
		if !strings.Contains(out, "Vote VAR Reward") {
			t.Error("expected 'Vote VAR Reward' in output")
		}
		if !strings.Contains(out, "Vote SKA Reward") {
			t.Error("expected 'Vote SKA Reward' in output")
		}
	})

	// Case 2 — VAR unit label
	t.Run("VARUnitLabel", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{PerBlock: 1.5}, nil))
		if !strings.Contains(out, "VAR/Vote") {
			t.Error("expected 'VAR/Vote' unit label in output")
		}
	})

	// Case 3 — data-voting-target preservation
	t.Run("DataTargetPreservation", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{PerBlock: 0.5, Per30Days: 1.23, PerYear: 15.0}, nil))
		if !strings.Contains(out, `data-voting-target="bsubsidyPos"`) {
			t.Error("expected data-voting-target=\"bsubsidyPos\" in output")
		}
		if !strings.Contains(out, `data-voting-target="ticketReward"`) {
			t.Error("expected data-voting-target=\"ticketReward\" in output")
		}
	})

	// Case 4 — Empty SKA slice
	t.Run("EmptySKASlice", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, []types.SKAVoteReward{}))
		if !strings.Contains(out, "No SKA rewards available") {
			t.Error("expected 'No SKA rewards available' in output")
		}
		if strings.Contains(out, "SKA1") || strings.Contains(out, "SKA2") {
			t.Error("expected no SKA symbol rows for empty SKA slice")
		}
	})

	// Case 5 — Single SKA entry
	t.Run("SingleSKAEntry", func(t *testing.T) {
		ska := []types.SKAVoteReward{
			{CoinType: 1, Symbol: "SKA1", PerBlock: "0.097178596780181388", PerYear: "0.038980675541825918"},
		}
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, ska))
		if strings.Contains(out, "No SKA rewards available") {
			t.Error("should not show placeholder when SKA entries are present")
		}
		if !strings.Contains(out, "SKA1") {
			t.Error("expected symbol 'SKA1' in output")
		}
		// PerBlock rendered via decimalParts: int "0", bold decimals "09", rest "7178596780181388"
		if !strings.Contains(out, `class="int"`) {
			t.Error("expected decimalParts int span in output")
		}
		if !strings.Contains(out, `class="decimal"`) {
			t.Error("expected decimalParts decimal span in output")
		}
		if !strings.Contains(out, "7178596780181388") {
			t.Error("expected trailing decimal digits of PerBlock in output")
		}
		if !strings.Contains(out, "SKA1/VAR") {
			t.Error("expected unit label 'SKA1/VAR' in output")
		}
	})

	// Case 6 — skaVoteRewards container present exactly once
	t.Run("SKAVoteRewardsContainerOnce", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, nil))
		count := strings.Count(out, `data-voting-target="skaVoteRewards"`)
		if count != 1 {
			t.Errorf("expected exactly 1 skaVoteRewards target, got %d", count)
		}
	})

	// Case 7 — decimalParts structure present for SKA per-block value
	t.Run("SKAPerBlockDecimalParts", func(t *testing.T) {
		ska := []types.SKAVoteReward{
			// value with significant non-zero decimals beyond the bold 2 places
			{CoinType: 2, Symbol: "SKA2", PerBlock: "1.234567890000000000", PerYear: "365.000000000000000000"},
		}
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, ska))
		if !strings.Contains(out, `class="decimal-parts`) {
			t.Error("expected decimal-parts div from decimalParts template")
		}
		// bold part "23" must appear in an int or decimal span
		if !strings.Contains(out, "23") {
			t.Error("expected bold decimal digits in output")
		}
		// rest significant digits must appear
		if !strings.Contains(out, "456789") {
			t.Error("expected rest decimal digits in output")
		}
	})
}

// --- Property-based tests ---

// Feature: voting-section-frontend, Property 1: VAR PerBlock value appears in rendered output
func TestProp_VARPerBlockInOutput(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		perBlock := rapid.Float64Range(0, 1e6).Draw(t, "perBlock")
		info := makeHomeInfo(types.VoteVARReward{PerBlock: perBlock}, nil)
		out := renderVotingCard(t, tmpl, info)
		// The integer part of the formatted value must appear in the output.
		intPart := fmt.Sprintf("%d", int64(perBlock))
		if !strings.Contains(out, intPart) {
			t.Errorf("expected integer part %q of PerBlock %v in output", intPart, perBlock)
		}
	})
}

// Feature: voting-section-frontend, Property 2: VAR percentage fields are formatted correctly
func TestProp_VARPercentageFormatting(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		per30Days := rapid.Float64Range(0, 100).Draw(t, "per30Days")
		perYear := rapid.Float64Range(0, 100).Draw(t, "perYear")
		info := makeHomeInfo(types.VoteVARReward{Per30Days: per30Days, PerYear: perYear}, nil)
		out := renderVotingCard(t, tmpl, info)

		want30 := fmt.Sprintf("%.2f", per30Days)
		if !strings.Contains(out, want30) {
			t.Errorf("expected Per30Days formatted as %q in output", want30)
		}
		if !strings.Contains(out, "per 30 days") {
			t.Error("expected 'per 30 days' label in output")
		}

		wantYear := fmt.Sprintf("%.2f", perYear)
		if !strings.Contains(out, wantYear) {
			t.Errorf("expected PerYear formatted as %q in output", wantYear)
		}
		if !strings.Contains(out, "per year") {
			t.Error("expected 'per year' label in output")
		}
	})
}

// Feature: voting-section-frontend, Property 3: SKA slice count and order are preserved
func TestProp_SKASliceOrderPreserved(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(1, 10).Draw(t, "n")
		skaRewards := make([]types.SKAVoteReward, n)
		symbols := make([]string, n)
		for i := 0; i < n; i++ {
			coinType := rapid.Uint8Range(1, 255).Draw(t, fmt.Sprintf("coinType%d", i))
			sym := fmt.Sprintf("SKA%d", coinType)
			skaRewards[i] = types.SKAVoteReward{
				CoinType: coinType,
				Symbol:   sym,
				PerBlock: "0.000000000000000001",
				PerYear:  "0.000000000000000365",
			}
			symbols[i] = sym
		}
		info := makeHomeInfo(types.VoteVARReward{}, skaRewards)
		out := renderVotingCard(t, tmpl, info)

		// Each symbol must appear in output.
		for _, sym := range symbols {
			if !strings.Contains(out, sym) {
				t.Errorf("expected symbol %q in output", sym)
			}
		}

		// Symbols must appear in input slice order.
		lastIdx := 0
		for _, sym := range symbols {
			idx := strings.Index(out[lastIdx:], sym)
			if idx < 0 {
				t.Errorf("symbol %q not found in output after position %d", sym, lastIdx)
				break
			}
			lastIdx += idx + len(sym)
		}
	})
}

// Feature: voting-section-frontend, Property 4: SKA pre-formatted strings are rendered verbatim
func TestProp_SKAStringsVerbatim(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		perBlock := rapid.StringMatching(`\d{1,15}\.\d{18}`).Draw(t, "perBlock")
		perYear := rapid.StringMatching(`\d{1,15}\.\d{18}`).Draw(t, "perYear")
		ska := []types.SKAVoteReward{
			{CoinType: 1, Symbol: "SKA1", PerBlock: perBlock, PerYear: perYear},
		}
		info := makeHomeInfo(types.VoteVARReward{}, ska)
		out := renderVotingCard(t, tmpl, info)

		// PerBlock is rendered via decimalParts using skaSplitParts.
		// Check the significant bold part and the rest both appear.
		parts := skaSplitParts(perBlock, 2)
		if !strings.Contains(out, parts[0]) { // integer
			t.Errorf("expected integer part %q of PerBlock in output", parts[0])
		}
		if parts[1] != "" && !strings.Contains(out, parts[1]) { // bold decimals
			t.Errorf("expected bold decimal part %q of PerBlock in output", parts[1])
		}
		if parts[2] != "" && !strings.Contains(out, parts[2]) { // rest decimals
			t.Errorf("expected rest decimal part %q of PerBlock in output", parts[2])
		}

		// Per30Days and PerYear are rendered verbatim.
		if !strings.Contains(out, perYear) {
			t.Errorf("expected PerYear %q verbatim in output", perYear)
		}
	})
}

// Feature: voting-section-frontend, Property 5: Rendered HTML is well-formed for all inputs
func TestProp_RenderedHTMLWellFormed(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 10).Draw(t, "n")
		skaRewards := make([]types.SKAVoteReward, n)
		for i := 0; i < n; i++ {
			coinType := rapid.Uint8Range(1, 255).Draw(t, fmt.Sprintf("coinType%d", i))
			skaRewards[i] = types.SKAVoteReward{
				CoinType: coinType,
				Symbol:   fmt.Sprintf("SKA%d", coinType),
				PerBlock: "0.000000000000000001",
				PerYear:  "0.000000000000000365",
			}
		}
		info := makeHomeInfo(types.VoteVARReward{PerBlock: 1.0, PerYear: 60.0}, skaRewards)
		out := renderVotingCard(t, tmpl, info)

		_, err := html.Parse(strings.NewReader(out))
		if err != nil {
			t.Errorf("rendered HTML is not well-formed: %v", err)
		}
	})
}

// Feature: voting-section-frontend, Property 6: skaVoteRewards container is present in rendered output
func TestProp_SKAVoteRewardsContainerExactlyOnce(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 10).Draw(t, "n")
		skaRewards := make([]types.SKAVoteReward, n)
		for i := 0; i < n; i++ {
			coinType := rapid.Uint8Range(1, 255).Draw(t, fmt.Sprintf("coinType%d", i))
			skaRewards[i] = types.SKAVoteReward{
				CoinType: coinType,
				Symbol:   fmt.Sprintf("SKA%d", coinType),
				PerBlock: "0.000000000000000001",
				PerYear:  "0.000000000000000365",
			}
		}
		info := makeHomeInfo(types.VoteVARReward{}, skaRewards)
		out := renderVotingCard(t, tmpl, info)

		count := strings.Count(out, `data-voting-target="skaVoteRewards"`)
		if count != 1 {
			t.Errorf("expected exactly 1 skaVoteRewards target, got %d", count)
		}
	})
}
