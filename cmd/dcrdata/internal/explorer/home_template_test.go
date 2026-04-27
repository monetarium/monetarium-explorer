package explorer

import (
	"strings"
	"testing"

	"github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-node/chaincfg"
)

// viewsFolder is relative to this package's location.
const viewsFolder = "../../views"

func newTestTemplates(t *testing.T) templates {
	t.Helper()
	funcMap := makeTemplateFuncMap(chaincfg.SimNetParams())
	funcMap["asset"] = func(name string) string { return "/dist/" + name }
	tmpl := newTemplates(viewsFolder, false, []string{"extras", "home_latest_blocks", "home_mempool", "home_voting", "home_mining", "home_supply"}, funcMap)
	if err := tmpl.addTemplate("home"); err != nil {
		t.Fatalf("addTemplate home: %v", err)
	}
	return tmpl
}

func TestHomeMempoolTemplateIncluded(t *testing.T) {
	tmpl := newTestTemplates(t)
	// Verify home_mempool partial is loaded by checking the mempoolCard template
	// is defined (it is parsed as part of the common templates).
	if tmpl.templates["home"].template.Lookup("mempoolCard") == nil {
		t.Error("expected mempoolCard template to be defined via home_mempool.tmpl")
	}
}

// makeTestMempool builds a MempoolInfo with the given CoinFills for template tests.
func makeTestMempool(totalFillRatio float64, activeSKACount int, fills []types.CoinFillData) *types.MempoolInfo {
	m := &types.MempoolInfo{}
	m.CoinFills = fills
	m.MempoolShort.TotalFillRatio = totalFillRatio
	m.MempoolShort.ActiveSKACount = activeSKACount
	return m
}

func TestHomeTemplate_IndicatorList(t *testing.T) {
	tmpl := newTestTemplates(t)

	fills := []types.CoinFillData{
		{Symbol: "VAR", GQFillRatio: 0.5, GQPositionRatio: 0.10, Status: "ok"},
		{Symbol: "SKA1", GQFillRatio: 0.8, GQPositionRatio: 0.45, ExtraFillRatio: 0.1, Status: "borrowing"},
	}
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
		Info:           &types.HomeInfo{},
		Mempool:        makeTestMempool(0.42, 1, fills),
		BestBlock:      makeTestBlock(100, nil),
		Blocks:         []*types.BlockBasic{makeTestBlock(100, nil)},
	}

	out, err := tmpl.execTemplateToString("home", data)
	if err != nil {
		t.Fatalf("template exec: %v", err)
	}

	// Indicator_List must NOT carry jsonly class (Requirement 4.5)
	if strings.Contains(out, `class="indicator-fill jsonly`) {
		t.Error("Indicator_List must not carry the jsonly class")
	}

	// data-active-ska-count must be present
	if !strings.Contains(out, `data-active-ska-count="1"`) {
		t.Error("expected data-active-ska-count attribute in rendered output")
	}

	// Total_Bar must be present
	if !strings.Contains(out, `data-homepage-target="totalBar"`) {
		t.Error("expected totalBar target in rendered output")
	}

	// Fill_Bars for each coin symbol
	for _, f := range fills {
		if !strings.Contains(out, `data-coin="`+f.Symbol+`"`) {
			t.Errorf("expected data-coin=%q in rendered output", f.Symbol)
		}
	}

	// fill-bar-template must be present
	if !strings.Contains(out, `id="fill-bar-template"`) {
		t.Error("expected fill-bar-template element in rendered output")
	}

	// indicatorList target must be present
	if !strings.Contains(out, `data-homepage-target="indicatorList"`) {
		t.Error("expected indicatorList target in rendered output")
	}
}

func TestHomeTemplate_IndicatorList_NoJSOnly(t *testing.T) {
	tmpl := newTestTemplates(t)
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
		Info:           &types.HomeInfo{},
		Mempool:        makeTestMempool(0.0, 0, nil),
		BestBlock:      makeTestBlock(1, nil),
		Blocks:         []*types.BlockBasic{makeTestBlock(1, nil)},
	}
	out, err := tmpl.execTemplateToString("home", data)
	if err != nil {
		t.Fatalf("template exec: %v", err)
	}
	// The indicator-fill div must not have jsonly in its class attribute
	if strings.Contains(out, `class="indicator-fill jsonly"`) || strings.Contains(out, `indicator-fill jsonly`) {
		t.Error("indicator-fill container must not carry jsonly class")
	}
}

func makeTestBlock(height int64, coinRows []types.CoinRowData) *types.BlockBasic {
	b := &types.BlockBasic{
		Height:         height,
		Hash:           strings.Repeat("0", 64),
		FormattedBytes: "1.0 kB",
		CoinRows:       coinRows,
	}
	b.FlattenCoinRows()
	return b
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
				{CoinType: 1, Symbol: "SKA1", Amount: "1000000000000000000"},
			})},
		},
		{
			name: "2 SKA types",
			blocks: []*types.BlockBasic{makeTestBlock(102, []types.CoinRowData{
				{CoinType: 0, Symbol: "VAR", Amount: "200000000"},
				{CoinType: 1, Symbol: "SKA1", Amount: "500000000000000000"},
				{CoinType: 2, Symbol: "SKA2", Amount: "250000000000000000"},
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
				Info:           &types.HomeInfo{},
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
