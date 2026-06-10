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
		if !strings.Contains(out, "Vote SKA Fee Reward") {
			t.Error("expected 'Vote SKA Fee Reward' in output")
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
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{PerBlock: 0.5, ROI: 15.0}, nil))
		if !strings.Contains(out, `data-voting-target="bsubsidyPos"`) {
			t.Error("expected data-voting-target=\"bsubsidyPos\" in output")
		}
		if !strings.Contains(out, `data-voting-target="varROI"`) {
			t.Error("expected data-voting-target=\"varROI\" in output")
		}
	})

	// Case 4 — Empty SKA slice. The placeholder text appears twice: once in the
	// visible {{else}} branch and once in the inert ska-vote-empty-template the
	// JS clones on live blocks (issue #436).
	t.Run("EmptySKASlice", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, []types.SKAVoteReward{}))
		if got := strings.Count(out, "No SKA rewards available"); got != 2 {
			t.Errorf("expected placeholder in visible branch + inert template (2), got %d", got)
		}
		if strings.Contains(out, "SKA1") || strings.Contains(out, "SKA2") {
			t.Error("expected no SKA symbol rows for empty SKA slice")
		}
	})

	// Case 5 — Single SKA entry. The visible {{else}} branch must not render, so
	// the placeholder text appears exactly once: in the inert
	// ska-vote-empty-template only (issue #436).
	t.Run("SingleSKAEntry", func(t *testing.T) {
		ska := []types.SKAVoteReward{
			{CoinType: 1, Symbol: "SKA1", PerBlock: "97178596780181388", PerYear: "38980675541825918"},
		}
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, ska))
		if got := strings.Count(out, "No SKA rewards available"); got != 1 {
			t.Errorf("expected placeholder only in inert template (1), got %d", got)
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
			{CoinType: 2, Symbol: "SKA2", PerBlock: "1234567890000000000", PerYear: "365000000000000000000"},
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

	// Case 8 — empty-state template present for JS live-update (issue #436).
	// The voting controller clears the skaVoteRewards container on every
	// websocket block and clones this template to restore the placeholder
	// when a block carries no SKA rewards; without it the text vanishes.
	t.Run("SKAVoteEmptyTemplatePresent", func(t *testing.T) {
		out := renderVotingCard(t, tmpl, makeHomeInfo(types.VoteVARReward{}, nil))
		if !strings.Contains(out, `id="ska-vote-empty-template"`) {
			t.Error("expected ska-vote-empty-template element for JS live-update")
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
		roi := rapid.Float64Range(0, 100).Draw(t, "roi")
		info := makeHomeInfo(types.VoteVARReward{ROI: roi}, nil)
		out := renderVotingCard(t, tmpl, info)

		wantROI := fmt.Sprintf("%.2f", roi)
		if !strings.Contains(out, wantROI) {
			t.Errorf("expected ROI formatted as %q in output", wantROI)
		}
		if !strings.Contains(out, "ROI:") {
			t.Error("expected 'ROI:' label in output")
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
				PerBlock: "1",
				PerYear:  "365",
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

// Feature: voting-section-frontend, Property 4: SKA atom strings are rendered as decimals
func TestProp_SKAAtomsRendered(t *testing.T) {
	tmpl := newVotingCardTemplates(t)
	rapid.Check(t, func(t *rapid.T) {
		// PerBlock must be an atom string (integer string).
		perBlock := rapid.StringMatching(`[1-9]\d{0,30}`).Draw(t, "perBlock")
		perYear := rapid.StringMatching(`[1-9]\d{0,30}`).Draw(t, "perYear")
		ska := []types.SKAVoteReward{
			{CoinType: 1, Symbol: "SKA1", PerBlock: perBlock, PerYear: perYear},
		}
		info := makeHomeInfo(types.VoteVARReward{}, ska)
		out := renderVotingCard(t, tmpl, info)

		// Verification: The output must contain the decimal parts div.
		if !strings.Contains(out, `class="decimal-parts`) {
			t.Error("expected decimal-parts div in output")
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
				PerBlock: "1",
				PerYear:  "365",
			}
		}
		info := makeHomeInfo(types.VoteVARReward{PerBlock: 1.0, ROI: 60.0}, skaRewards)
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
				PerBlock: "1",
				PerYear:  "365",
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
