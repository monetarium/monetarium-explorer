package explorer

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	explorerTypes "github.com/monetarium/monetarium-explorer/explorer/types"
)

// latestExplorerBlocks backs the "getlatestblocks" websocket command. It must
// request the same range the home page renders (tip down to tip-homeBlocksSpan)
// and return blocks carrying CoinRows, so the client can rebuild the table
// identically to the server-rendered list.
func TestLatestExplorerBlocks(t *testing.T) {
	// A known block time so the marshaled JSON can be checked for the exact
	// RFC3339 string the client's `new Date(block.time)` depends on.
	blockTime := explorerTypes.NewTimeDefFromUNIX(1749585600)
	src := &mockDataSource{
		height: 1000,
		explorerBlocks: []*explorerTypes.BlockBasic{
			{Height: 1000, Hash: "hash1000", BlockTime: blockTime,
				CoinRows: []explorerTypes.CoinRowData{
					{CoinType: 0, Symbol: "VAR", Amount: "12345"},
					{CoinType: 1, Symbol: "SKA1", Amount: "67890"},
				}},
			{Height: 999, Hash: "hash999", BlockTime: blockTime},
		},
	}
	exp := &explorerUI{dataSource: src}

	blocks, err := exp.latestExplorerBlocks(context.Background(), homeBlocksSpan)
	if err != nil {
		t.Fatalf("latestExplorerBlocks returned error: %v", err)
	}

	// Requests tip..tip-span (the home table range for span == homeBlocksSpan).
	if src.gotBlocksStart != 1000 || src.gotBlocksEnd != 1000-homeBlocksSpan {
		t.Errorf("requested range = %d..%d, want %d..%d",
			src.gotBlocksStart, src.gotBlocksEnd, 1000, 1000-homeBlocksSpan)
	}

	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want 2", len(blocks))
	}

	out, err := json.Marshal(blocks)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	// The client renders the coin amounts straight from this JSON — assert the
	// actual values survive, not merely that the key exists.
	for _, want := range []string{`"coin_rows"`, `"amount":"12345"`, `"amount":"67890"`} {
		if !strings.Contains(string(out), want) {
			t.Errorf("marshaled blocks missing %s: %s", want, out)
		}
	}
	// time must marshal as the RFC3339 string the client parses with new Date();
	// a regression to a UNIX int or wrapper object would break the refresh.
	if wantTime := blockTime.RFC3339(); !strings.Contains(string(out), wantTime) {
		t.Errorf("marshaled blocks missing RFC3339 time %q: %s", wantTime, out)
	}
}

// latestExplorerBlocks must drop the zero-value placeholder blocks that
// GetExplorerBlocks emits for heights that fail to load, so the websocket
// refresh never rebuilds the table with a /block/0 row. A real block —
// including genesis at height 0 — has a non-empty hash and must survive.
func TestLatestExplorerBlocksFiltersPlaceholders(t *testing.T) {
	src := &mockDataSource{
		height: 1000,
		explorerBlocks: []*explorerTypes.BlockBasic{
			{Height: 1000, Hash: "tip"},
			{},                           // zero-value placeholder for a height that failed to load
			{Height: 0, Hash: "genesis"}, // genesis: height 0 but real — must survive
		},
	}
	exp := &explorerUI{dataSource: src}

	blocks, err := exp.latestExplorerBlocks(context.Background(), homeBlocksSpan)
	if err != nil {
		t.Fatalf("latestExplorerBlocks returned error: %v", err)
	}
	if len(blocks) != 2 {
		t.Fatalf("got %d blocks, want 2 (zero-value placeholder dropped)", len(blocks))
	}
	var sawGenesis bool
	for _, b := range blocks {
		if b.Hash == "" {
			t.Errorf("placeholder block (empty hash) leaked into the refresh list")
		}
		if b.Height == 0 && b.Hash == "genesis" {
			sawGenesis = true
		}
	}
	if !sawGenesis {
		t.Error("genesis block (height 0, real hash) was incorrectly filtered out")
	}
}

// latestBlocksEnd is the single source of the GetExplorerBlocks "end" argument
// shared by Home() and latestExplorerBlocks(); the two must request the same
// range so the server-rendered list and the websocket refresh never diverge,
// including the below-genesis clamp at low chain heights.
func TestLatestBlocksEnd(t *testing.T) {
	tests := []struct {
		name   string
		height int64
		span   int
		want   int
	}{
		{"normal range", 1000, homeBlocksSpan, 1000 - homeBlocksSpan},
		{"full page span", 1000, maxExplorerRows, 1000 - maxExplorerRows},
		{"end exactly zero", 8, 8, 0},
		{"end below genesis clamps to -1", 5, 8, -1},
		{"tip at genesis clamps to -1", 0, homeBlocksSpan, -1},
		{"span of one at genesis", 1, 1, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := latestBlocksEnd(tt.height, tt.span); got != tt.want {
				t.Errorf("latestBlocksEnd(%d, %d) = %d, want %d",
					tt.height, tt.span, got, tt.want)
			}
		})
	}
}

// clampLatestBlocksSpan resolves the optional "getlatestblocks" page-size
// argument. It must default to the home span for empty/invalid/non-positive
// input and cap large requests at maxExplorerRows so an unauthenticated client
// can't ask for a tip-to-genesis range (each block is a DB round-trip).
func TestClampLatestBlocksSpan(t *testing.T) {
	tests := []struct {
		name    string
		message string
		want    int
	}{
		{"empty defaults to home span", "", homeBlocksSpan},
		{"invalid defaults to home span", "abc", homeBlocksSpan},
		{"zero defaults to home span", "0", homeBlocksSpan},
		{"negative defaults to home span", "-5", homeBlocksSpan},
		{"valid in-range value passes through", "20", 20},
		{"at cap passes through", strconv.Itoa(maxExplorerRows), maxExplorerRows},
		{"just under cap passes through", strconv.Itoa(maxExplorerRows - 1), maxExplorerRows - 1},
		{"just over cap clamps", strconv.Itoa(maxExplorerRows + 1), maxExplorerRows},
		{"huge value clamps (DoS guard)", "999999", maxExplorerRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := clampLatestBlocksSpan(tt.message); got != tt.want {
				t.Errorf("clampLatestBlocksSpan(%q) = %d, want %d", tt.message, got, tt.want)
			}
		})
	}
}

// span parameterizes the range so /blocks can refresh its own page size, and a
// span that would reach below genesis clamps the lower bound to -1.
func TestLatestExplorerBlocksSpan(t *testing.T) {
	src := &mockDataSource{height: 1000}
	exp := &explorerUI{dataSource: src}

	if _, err := exp.latestExplorerBlocks(context.Background(), 20); err != nil {
		t.Fatalf("latestExplorerBlocks returned error: %v", err)
	}
	if src.gotBlocksStart != 1000 || src.gotBlocksEnd != 980 {
		t.Errorf("span=20 range = %d..%d, want 1000..980", src.gotBlocksStart, src.gotBlocksEnd)
	}

	// A span larger than the tip height clamps the end to -1 (genesis guard).
	src.height = 5
	if _, err := exp.latestExplorerBlocks(context.Background(), 20); err != nil {
		t.Fatalf("latestExplorerBlocks returned error: %v", err)
	}
	if src.gotBlocksEnd != -1 {
		t.Errorf("clamped end = %d, want -1", src.gotBlocksEnd)
	}
}
