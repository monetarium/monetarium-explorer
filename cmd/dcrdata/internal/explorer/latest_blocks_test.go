package explorer

import (
	"context"
	"encoding/json"
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

	blocks, err := exp.latestExplorerBlocks(context.Background())
	if err != nil {
		t.Fatalf("latestExplorerBlocks returned error: %v", err)
	}

	// Requests tip..tip-homeBlocksSpan (the home table range).
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
