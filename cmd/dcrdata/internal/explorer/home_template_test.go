package explorer

import (
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

// viewsFolder is relative to this package's location.
const viewsFolder = "../../views"

func newTestTemplates(t *testing.T) templates {
	t.Helper()
	tmpl := newTemplates(viewsFolder, false, []string{"extras"}, makeTemplateFuncMap(chaincfg.SimNetParams()))
	if err := tmpl.addTemplate("home"); err != nil {
		t.Fatalf("addTemplate home: %v", err)
	}
	return tmpl
}

func makeTestBlock(height int64, coinRows []types.CoinRowData) *types.BlockBasic {
	return &types.BlockBasic{
		Height:         height,
		Hash:           strings.Repeat("0", 64),
		FormattedBytes: "1.0 kB",
		CoinRows:       coinRows,
	}
}

func TestHomeTemplate_BlocksTable(t *testing.T) {
	tmpl := newTestTemplates(t)

	cases := []struct {
		name   string
		blocks []*types.BlockBasic
	}{
		{
			name:   "0 SKA types",
			blocks: []*types.BlockBasic{makeTestBlock(100, nil)},
		},
		{
			name: "1 SKA type",
			blocks: []*types.BlockBasic{makeTestBlock(101, []types.CoinRowData{
				{CoinType: 0, Symbol: "VAR", Amount: "100000000"},
				{CoinType: 1, Symbol: "SKA-1", Amount: "1000000000000000000"},
			})},
		},
		{
			name: "2 SKA types",
			blocks: []*types.BlockBasic{makeTestBlock(102, []types.CoinRowData{
				{CoinType: 0, Symbol: "VAR", Amount: "200000000"},
				{CoinType: 1, Symbol: "SKA-1", Amount: "500000000000000000"},
				{CoinType: 2, Symbol: "SKA-2", Amount: "250000000000000000"},
			})},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := struct {
				*CommonPageData
				Info          *types.HomeInfo
				Mempool       *types.MempoolInfo
				BestBlock     *types.BlockBasic
				BlockTally    []int
				Consensus     int
				Blocks        []*types.BlockBasic
				Conversions   interface{}
				PercentChange float64
			}{
				CommonPageData: &CommonPageData{Links: &links{}, Tip: &types.WebBasicBlock{}},
				Info:           &types.HomeInfo{TreasuryBalance: &dbtypes.TreasuryBalance{}},
				Mempool:        &types.MempoolInfo{},
				BestBlock:      tc.blocks[0],
				Blocks:         tc.blocks,
			}
			out, err := tmpl.execTemplateToString("home", data)
			if err != nil {
				t.Fatalf("template exec: %v", err)
			}
			// Verify coin symbols appear in output when CoinRows present.
			for _, blk := range tc.blocks {
				for _, row := range blk.CoinRows {
					if !strings.Contains(out, row.Symbol) {
						t.Errorf("expected %q in rendered output", row.Symbol)
					}
				}
			}
		})
	}
}
