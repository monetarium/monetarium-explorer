package explorer

import (
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/explorer/types"
)

func TestAddressSummaryTemplate(t *testing.T) {
	tmpl := newTestTemplates(t)
	if err := tmpl.addTemplate("address"); err != nil {
		t.Fatalf("addTemplate address: %v", err)
	}

	addrInfo := &dbtypes.AddressInfo{
		Address:     "TtestAddress",
		ActiveCoins: []uint8{0, 1},
		Balance: &dbtypes.AddressBalance{
			Coins: map[uint8]*dbtypes.CoinBalance{
				0: {
					CoinType:      0,
					TotalReceived: 123456789000,
					TotalSpent:    23456789000,
					TotalUnspent:  100000000000,
					NumSpent:      2,
					NumUnspent:    1,
				},
				1: {
					CoinType:         1,
					TotalReceivedSKA: "5000000000000000000000",
					TotalSpentSKA:    "2000000000000000000000",
					TotalUnspentSKA:  "3000000000000000000000",
					NumSpent:         1,
					NumUnspent:       1,
				},
			},
			TotalOutputs: 5,
			TotalInputs:  3,
		},
	}

	out, err := tmpl.execPartial("address", "addressSummary", addrInfo)
	if err != nil {
		t.Fatalf("addressSummary template exec: %v", err)
	}

	// Coin symbols for both VAR and SKA1 are rendered.
	for _, symbol := range []string{"VAR", "SKA1"} {
		if !strings.Contains(out, symbol) {
			t.Errorf("expected %q to appear in addressSummary output", symbol)
		}
	}

	// VAR amounts (8 decimals) rendered from int64 atoms.
	if !strings.Contains(out, "1,234") {
		t.Errorf("expected VAR received 1,234 in addressSummary output:\n%s", out)
	}
	// SKA amounts (18 decimals) rendered from big.Int-derived strings.
	if !strings.Contains(out, "5,000") {
		t.Errorf("expected SKA received 5,000 in addressSummary output:\n%s", out)
	}

	// Outputs/inputs tallies.
	if !strings.Contains(out, "5 outputs") {
		t.Errorf("expected outputs tally in addressSummary output:\n%s", out)
	}
	if !strings.Contains(out, "3 inputs") {
		t.Errorf("expected inputs tally in addressSummary output:\n%s", out)
	}
}

func TestAddressUnconfirmedBadgesTemplate(t *testing.T) {
	tmpl := newTestTemplates(t)
	if err := tmpl.addTemplate("address"); err != nil {
		t.Fatalf("addTemplate address: %v", err)
	}

	addrInfo := &dbtypes.AddressInfo{
		Address:     "TtestAddress",
		ActiveCoins: []uint8{0, 1},
		NumUnconfirmedByCoin: map[uint8]int64{
			0: 3,
			1: 0,
		},
	}

	out, err := tmpl.execPartial("address", "addressUnconfirmedBadges", addrInfo)
	if err != nil {
		t.Fatalf("addressUnconfirmedBadges template exec: %v", err)
	}

	// A badge is rendered for every active coin type, even at zero count —
	// the zero-count one is hidden with d-hide so the controller can reveal
	// it later without recreating the element.
	for _, symbol := range []string{"VAR", "SKA1"} {
		if !strings.Contains(out, "Unconfirmed "+symbol) {
			t.Errorf("expected %q badge to appear in addressUnconfirmedBadges output:\n%s", symbol, out)
		}
	}
	// Strip whitespace so attribute spread across template lines still matches.
	compact := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\t' {
			return -1
		}
		return r
	}, out)
	if !strings.Contains(compact, `data-coin-type="0"data-count="3"`) {
		t.Errorf("expected VAR badge with count 3 in addressUnconfirmedBadges output:\n%s", out)
	}
	if !strings.Contains(compact, `data-coin-type="1"data-count="0"`) ||
		!strings.Contains(compact, `text-startd-hide`) {
		t.Errorf("expected zero-count SKA1 badge to be d-hide in addressUnconfirmedBadges output:\n%s", out)
	}
}

func TestAddressSummaryTemplate_EmptyBalance(t *testing.T) {
	tmpl := newTestTemplates(t)
	if err := tmpl.addTemplate("address"); err != nil {
		t.Fatalf("addTemplate address: %v", err)
	}

	// No active coins and nil balance — must render the dash placeholders and
	// not blow up on nil map lookups.
	addrInfo := &dbtypes.AddressInfo{Address: "TtestAddress"}

	out, err := tmpl.execPartial("address", "addressSummary", addrInfo)
	if err != nil {
		t.Fatalf("addressSummary template exec: %v", err)
	}

	if !strings.Contains(out, "&mdash;") {
		t.Errorf("expected dash placeholder in addressSummary output:\n%s", out)
	}
	if strings.Contains(out, "nil") || strings.Contains(out, "<no value>") {
		t.Errorf("unexpected nil rendering in addressSummary output:\n%s", out)
	}
}

// TestAddressPageDivBalance renders the full address page and verifies the
// div structure stays balanced. This guards against template extraction
// leaving orphaned opening/closing tags (a stray </div> silently moves the
// chart column out of its row without failing template execution).
func TestAddressPageDivBalance(t *testing.T) {
	tmpl := newTestTemplates(t)
	if err := tmpl.addTemplate("address"); err != nil {
		t.Fatalf("addTemplate address: %v", err)
	}

	addrInfo := &dbtypes.AddressInfo{
		Address:     "TtestAddress",
		ActiveCoins: []uint8{0, 1},
		NumUnconfirmedByCoin: map[uint8]int64{
			0: 3,
			1: 0,
		},
		Balance: &dbtypes.AddressBalance{
			Coins: map[uint8]*dbtypes.CoinBalance{
				0: {
					CoinType:      0,
					TotalReceived: 123456789000,
					TotalSpent:    23456789000,
					TotalUnspent:  100000000000,
					FromStake:     0.1,
					ToStake:       0.2,
					NumSpent:      2,
					NumUnspent:    1,
				},
				1: {
					CoinType:         1,
					TotalReceivedSKA: "5000000000000000000000",
					TotalSpentSKA:    "2000000000000000000000",
					TotalUnspentSKA:  "3000000000000000000000",
					FromStake:        0.05,
					ToStake:          0.03,
					NumSpent:         1,
					NumUnspent:       1,
				},
			},
			TotalOutputs: 5,
			TotalInputs:  3,
		},
		Path: "/address/TtestAddress",
	}

	data := struct {
		*CommonPageData
		Data         *dbtypes.AddressInfo
		Pages        []pageNumber
		CRLFDownload bool
	}{
		CommonPageData: &CommonPageData{
			Path:  "/address/TtestAddress",
			Tip:   &types.WebBasicBlock{},
			Links: &links{},
		},
		Data:  addrInfo,
		Pages: nil, // empty triggers zero pages
	}

	out, err := tmpl.exec("address", data)
	if err != nil {
		t.Fatalf("address page template exec: %v", err)
	}

	opens := strings.Count(out, "<div")
	closes := strings.Count(out, "</div>")
	if opens != closes {
		t.Errorf("unbalanced divs in address page: %d opens vs %d closes\n%s", opens, closes, out)
	}

	// Stake blocks must render inside a .row (regression: the badge partial
	// extraction previously orphaned their row's closing tag).
	for _, label := range []string{">Stake income</span>", ">Stake spending</span>"} {
		if !strings.Contains(out, label) {
			t.Errorf("expected %q in address page output:\n%s", label, out)
		}
	}
}
