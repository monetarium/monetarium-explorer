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

// TestBlockCoinbaseGenesisWarningOnlyForGenesis verifies the genesis-coinbase
// warning renders ONLY for the actual genesis block (Height == 0). Monetarium
// mainnet regularly produces mined blocks with header nonce 0, so the legacy
// Nonce == 0 heuristic mislabeled valid coinbases as genesis.
func TestBlockCoinbaseGenesisWarningOnlyForGenesis(t *testing.T) {
	tmpl := loadBlockTemplate(t)

	const coinbaseTxID = "1111111111111111111111111111111111111111111111111111111111111111"

	blockWithCoinbase := func(height int64, nonce uint32) *types.BlockInfo {
		return &types.BlockInfo{
			BlockBasic: &types.BlockBasic{
				Height:    height,
				MainChain: true,
				Valid:     true,
			},
			Nonce: nonce,
			Tx: []*types.TrimmedTxInfo{
				{
					TxBasic: &types.TxBasic{
						TxID:          coinbaseTxID,
						FormattedSize: "1 B",
						Coinbase:      true,
					},
				},
			},
		}
	}

	const warningMarker = "The genesis block coinbase transaction is bootstrap data"

	// A non-genesis block whose header nonce is 0 must NOT render the warning.
	out := renderBlock(t, tmpl, blockWithCoinbase(35356, 0))
	if strings.Contains(out, warningMarker) || strings.Contains(out, "&#9888;") {
		t.Errorf("non-genesis nonce-0 block: expected NO genesis warning, got %s", out)
	}
	if !strings.Contains(out, `<span><a class="hash" href="/tx/`+coinbaseTxID+`">`) {
		t.Errorf("non-genesis nonce-0 block: expected plain tx link to %s", coinbaseTxID)
	}

	// A non-genesis block with a non-zero nonce must not render the warning.
	out = renderBlock(t, tmpl, blockWithCoinbase(12345, 2298291440))
	if strings.Contains(out, warningMarker) || strings.Contains(out, "&#9888;") {
		t.Errorf("non-genesis non-zero nonce block: expected NO genesis warning")
	}

	// The actual genesis block (height 0) must still render the warning, but
	// with the txid as PLAIN TEXT: the node's txindex never indexes block 0,
	// so /tx/<genesis coinbase> would 404.
	out = renderBlock(t, tmpl, blockWithCoinbase(0, 0))
	for _, want := range []string{"&#9888;", warningMarker, ">" + coinbaseTxID + "<"} {
		if !strings.Contains(out, want) {
			t.Errorf("genesis block: expected rendered output to contain %q", want)
		}
	}
	if strings.Contains(out, `<a class="hash" href="/tx/`+coinbaseTxID+`">`) {
		t.Errorf("genesis block: expected plain text txid, got a link to %s", coinbaseTxID)
	}
}
