package explorer

import (
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

// loadBlockTemplate parses block.tmpl plus extras.tmpl with the production
// helper FuncMap. Fails the test on parse error.
func loadBlockTemplate(t *testing.T) templates {
	t.Helper()
	funcMap := makeTemplateFuncMap(chaincfg.SimNetParams())
	funcMap["asset"] = func(name string) string { return "/dist/" + name }
	tmpl := newTemplates(viewsFolder, false, []string{"extras"}, funcMap)
	if err := tmpl.addTemplate("block"); err != nil {
		t.Fatalf("addTemplate block: %v", err)
	}
	return tmpl
}

// renderBlock executes the block template against a *types.BlockInfo and
// returns the rendered HTML, mirroring the data shape assembled by
// (*explorerUI).Block.
func renderBlock(t *testing.T, tmpl templates, bi *types.BlockInfo) string {
	t.Helper()
	data := struct {
		*CommonPageData
		Data      *types.BlockInfo
		AltBlocks []*dbtypes.BlockStatus
	}{
		CommonPageData: &CommonPageData{Links: &links{}, Tip: &types.WebBasicBlock{}},
		Data:           bi,
	}
	pt, ok := tmpl.templates["block"]
	if !ok {
		t.Fatal("block template not loaded")
	}
	var sb strings.Builder
	if err := pt.template.ExecuteTemplate(&sb, "block", data); err != nil {
		t.Fatalf("execute block: %v", err)
	}
	return sb.String()
}

// TestBlockRevocationsTicketStatusCapitalized verifies issue #479: the Ticket
// Status column of the block-details Revocations table renders the revocation
// reason in Title Case ("Missed", "Expired") rather than the lowercase value
// stored on TrimmedTxInfo.TicketStatus.
func TestBlockRevocationsTicketStatusCapitalized(t *testing.T) {
	tmpl := loadBlockTemplate(t)

	bi := &types.BlockInfo{
		BlockBasic: &types.BlockBasic{
			Height:      12345,
			MainChain:   true,
			Valid:       true,
			Revocations: 2,
		},
		Revs: []*types.TrimmedTxInfo{
			{
				TxBasic:      &types.TxBasic{TxID: "1111111111111111111111111111111111111111111111111111111111111111", FormattedSize: "1 B"},
				TicketStatus: "missed",
			},
			{
				TxBasic:      &types.TxBasic{TxID: "2222222222222222222222222222222222222222222222222222222222222222", FormattedSize: "1 B"},
				TicketStatus: "expired",
			},
		},
	}

	out := renderBlock(t, tmpl, bi)

	for _, want := range []string{">Missed<", ">Expired<"} {
		if !strings.Contains(out, want) {
			t.Errorf("Ticket Status cell: expected rendered output to contain %q", want)
		}
	}
	for _, notWant := range []string{">missed<", ">expired<"} {
		if strings.Contains(out, notWant) {
			t.Errorf("Ticket Status cell: expected rendered output NOT to contain lowercase %q", notWant)
		}
	}
}
