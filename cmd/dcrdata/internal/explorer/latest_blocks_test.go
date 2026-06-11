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
	src := &mockDataSource{
		height: 1000,
		explorerBlocks: []*explorerTypes.BlockBasic{
			{Height: 1000, CoinRows: []explorerTypes.CoinRowData{
				{CoinType: 0, Symbol: "VAR", Amount: "12345"},
				{CoinType: 1, Symbol: "SKA1", Amount: "67890"},
			}},
			{Height: 999},
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

	// The JSON the websocket sends must carry coin_rows (what the client renders).
	out, err := json.Marshal(blocks)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	if !strings.Contains(string(out), `"coin_rows"`) {
		t.Errorf("marshaled blocks missing coin_rows: %s", out)
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
