package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
)

// blockSummaryDS overrides GetSummaryByHash to return multi-coin data.
type blockSummaryDS struct {
	noopDS
}

func (blockSummaryDS) GetSummaryByHash(_ context.Context, hash string, _ bool) *apitypes.BlockDataBasic {
	return &apitypes.BlockDataBasic{
		Height: 42,
		Hash:   hash,
		CoinAmounts: map[uint8]string{
			0: "100000000",
			1: "1000000000000000000",
		},
	}
}

func TestGetBlockSummary_CoinAmounts(t *testing.T) {
	app := &appContext{DataSource: blockSummaryDS{}}
	mux := NewAPIRouter(app, "", false, false)

	// /block/hash/{blockhash} is the route that calls getBlockSummary via hash.
	const testHash = "0000000000000000000000000000000000000000000000000000000000000001"
	req := httptest.NewRequest(http.MethodGet, "/block/hash/"+testHash, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var result apitypes.BlockDataBasic
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.CoinAmounts == nil {
		t.Fatal("CoinAmounts must not be nil")
	}
	if result.CoinAmounts[0] != "100000000" {
		t.Errorf("VAR: want 100000000, got %s", result.CoinAmounts[0])
	}
	if result.CoinAmounts[1] != "1000000000000000000" {
		t.Errorf("SKA1: want 1000000000000000000, got %s", result.CoinAmounts[1])
	}
}

func TestTreasuryRoute_Returns410(t *testing.T) {
	mux := NewAPIRouter(&appContext{DataSource: noopDS{}}, "", false, false)
	for _, path := range []string{"/treasury/balance", "/treasury/io/day"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusGone {
			t.Errorf("GET %s: want 410, got %d", path, w.Code)
		}
	}
}

func TestProposalRoute_Returns410(t *testing.T) {
	mux := NewAPIRouter(&appContext{DataSource: noopDS{}}, "", false, false)
	req := httptest.NewRequest(http.MethodGet, "/proposal/sometoken", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusGone {
		t.Errorf("want 410, got %d", w.Code)
	}
}

func TestAPIVout_SKAFields(t *testing.T) {
	// Verify that apitypes.Vout carries CoinType and SKAValue and that they
	// round-trip through JSON without precision loss.
	vout := apitypes.Vout{
		Value:    0,
		N:        0,
		CoinType: 1,
		SKAValue: "900000000000000000000000000000000",
	}
	b, err := json.Marshal(vout)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got apitypes.Vout
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.CoinType != 1 {
		t.Errorf("CoinType: want 1, got %d", got.CoinType)
	}
	if got.SKAValue != vout.SKAValue {
		t.Errorf("SKAValue: want %s, got %s", vout.SKAValue, got.SKAValue)
	}
}

func TestAPITxOut_SKAFields(t *testing.T) {
	txout := apitypes.TxOut{
		Value:    0,
		CoinType: 2,
		SKAValue: "123456789012345678901234567890",
	}
	b, err := json.Marshal(txout)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got apitypes.TxOut
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.CoinType != 2 {
		t.Errorf("CoinType: want 2, got %d", got.CoinType)
	}
	if got.SKAValue != txout.SKAValue {
		t.Errorf("SKAValue: want %s, got %s", txout.SKAValue, got.SKAValue)
	}
}
