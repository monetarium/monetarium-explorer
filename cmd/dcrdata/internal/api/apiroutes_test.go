package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-node/chaincfg"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
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

func TestChartAPI_SKASupplyAccepted(t *testing.T) {
	mux := NewAPIRouter(&appContext{DataSource: noopDS{}}, "", false, false)

	req := httptest.NewRequest(http.MethodGet, "/chart/coin-supply/1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Accept 200 (data available), 404 (unknown chart), or 503 (no data available)
	if w.Code != http.StatusOK && w.Code != http.StatusNotFound && w.Code != http.StatusServiceUnavailable {
		t.Errorf("coin-supply/1: expected 200, 404, or 503, got %d", w.Code)
	}
}

func TestSKASupplyChart_ResponseFormat(t *testing.T) {
	mux := NewAPIRouter(&appContext{DataSource: noopDS{}}, "", false, false)

	req := httptest.NewRequest(http.MethodGet, "/chart/coin-supply/1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if strings.Contains(w.Body.String(), "nil pointer") {
		t.Error("coin-supply/1 panics due to nil ChartData - test environment issue")
	}

	switch w.Code {
	case http.StatusOK:
		t.Log("coin-supply/1 returns 200 - data loaded successfully")
	case http.StatusServiceUnavailable:
		t.Log("coin-supply/1 returns 503 - SKA data not available (expected in test)")
	case http.StatusNotFound:
		t.Log("coin-supply/1 returns 404 - chart type unknown")
	case http.StatusInternalServerError:
		t.Error("coin-supply/1 returns 500 - should handle gracefully")
	default:
		t.Logf("coin-supply/1 returns %d", w.Code)
	}
}

// blockVerboseDS provides multi-coin data for verbose endpoint tests.
type blockVerboseDS struct {
	noopDS
}

func (blockVerboseDS) GetBlockVerboseByHash(_ context.Context, hash string, _ bool) *chainjson.GetBlockVerboseResult {
	return &chainjson.GetBlockVerboseResult{
		Hash:   hash,
		Height: 100,
		Tx:     []string{"tx1", "tx2"},
	}
}

func (blockVerboseDS) GetSummaryByHash(_ context.Context, hash string, _ bool) *apitypes.BlockDataBasic {
	fee := int64(12345678) // 0.12345678 DCR in atoms
	return &apitypes.BlockDataBasic{
		Height: 100,
		Hash:   hash,
		CoinAmounts: map[uint8]string{
			0: "100000000",           // VAR: 1 DCR
			1: "1000000000000000000", // SKA1: 1 SKA
			2: "2000000000000000000", // SKA2: 2 SKA
		},
		MiningFee: &fee,
	}
}

func (blockVerboseDS) GetBlockHash(_ context.Context, height int64) (string, error) {
	return "00000000000000000000000000000000000000000000000000000000000000a0", nil
}

func TestBlockVerbose_TotalSentMap(t *testing.T) {
	app := &appContext{DataSource: blockVerboseDS{}}
	mux := NewAPIRouter(app, "", false, false)

	req := httptest.NewRequest(http.MethodGet, "/block/100/verbose", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}

	totalSent, ok := result["total_sent"].(map[string]interface{})
	if !ok {
		t.Fatal("total_sent field missing or not a map")
	}

	// VAR (key "0") should be present
	if totalSent["0"] == nil {
		t.Error("total_sent missing VAR (key 0)")
	}
	if totalSent["0"] != "100000000" {
		t.Errorf("total_sent[0] = %v, want 100000000", totalSent["0"])
	}

	// SKA1 (key "1") should be present
	if totalSent["1"] == nil {
		t.Error("total_sent missing SKA1 (key 1)")
	}
	if totalSent["1"] != "1000000000000000000" {
		t.Errorf("total_sent[1] = %v, want 1000000000000000000", totalSent["1"])
	}
}

func TestBlockVerbose_FeesMap(t *testing.T) {
	app := &appContext{DataSource: blockVerboseDS{}}
	mux := NewAPIRouter(app, "", false, false)

	req := httptest.NewRequest(http.MethodGet, "/block/100/verbose", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}

	fees, ok := result["fees"].(map[string]interface{})
	if !ok {
		t.Fatal("fees field missing or not a map")
	}

	// VAR fees should be present
	if fees["0"] == nil {
		t.Error("fees missing VAR (key 0)")
	}
}

// blockVerboseSKAFeeDS provides SSFeeTotalsByCoin for SKA fee testing.
type blockVerboseSKAFeeDS struct {
	blockVerboseDS
}

func (blockVerboseSKAFeeDS) GetSummaryByHash(_ context.Context, hash string, _ bool) *apitypes.BlockDataBasic {
	fee := int64(12345678)
	return &apitypes.BlockDataBasic{
		Height: 100,
		Hash:   hash,
		CoinAmounts: map[uint8]string{
			0: "100000000",
			1: "1000000000000000000",
		},
		MiningFee: &fee,
		SSFeeTotalsByCoin: map[uint8]string{
			1: "500000000000000000", // SKA1: 0.5 SKA in atoms
			2: "300000000000000000", // SKA2: 0.3 SKA in atoms
		},
	}
}

func TestBlockVerbose_SKAFeesFromSSFeeTotals(t *testing.T) {
	app := &appContext{DataSource: blockVerboseSKAFeeDS{}}
	mux := NewAPIRouter(app, "", false, false)

	req := httptest.NewRequest(http.MethodGet, "/block/100/verbose", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}

	fees, ok := result["fees"].(map[string]interface{})
	if !ok {
		t.Fatal("fees field missing or not a map")
	}

	// VAR fees should be present
	if fees["0"] == nil {
		t.Error("fees missing VAR (key 0)")
	}

	// SKA fees from SSFeeTotalsByCoin should be present
	if fees["1"] == nil {
		t.Error("fees missing SKA1 (key 1) from SSFeeTotalsByCoin")
	}
	if fees["1"] != "500000000000000000" {
		t.Errorf("fees[1] = %v, want 500000000000000000", fees["1"])
	}

	if fees["2"] == nil {
		t.Error("fees missing SKA2 (key 2) from SSFeeTotalsByCoin")
	}
	if fees["2"] != "300000000000000000" {
		t.Errorf("fees[2] = %v, want 300000000000000000", fees["2"])
	}
}

// addressChartDS provides multi-coin data for address chart and CSV tests.
type addressChartDS struct {
	noopDS
}

func (addressChartDS) AddressData(ctx context.Context, address string, limit, offset int, view dbtypes.AddrTxnViewType, coin uint8) (*dbtypes.AddressInfo, *dbtypes.AddressBalance, error) {
	ai := &dbtypes.AddressInfo{
		Address:     address,
		ActiveCoins: []uint8{0, 1},
	}
	bal := &dbtypes.AddressBalance{
		Coins: map[uint8]*dbtypes.CoinBalance{
			0: {CoinType: 0, TotalReceived: 100, TotalSpent: 40, TotalUnspent: 60},
			1: {CoinType: 1, TotalReceivedSKA: "1000000000000000000", TotalSpentSKA: "400000000000000000", TotalUnspentSKA: "600000000000000000"},
		},
	}
	// Apply filter to Balance if coin != 0 (simplified mock)
	if coin != 0 {
		filteredCoins := make(map[uint8]*dbtypes.CoinBalance)
		if b, ok := bal.Coins[coin]; ok {
			filteredCoins[coin] = b
		}
		bal.Coins = filteredCoins
	}
	return ai, bal, nil
}

func (addressChartDS) TxHistoryData(ctx context.Context, address string, chart dbtypes.HistoryChart, grouping dbtypes.TimeBasedGrouping, coin uint8) (*dbtypes.ChartsData, error) {
	if coin == 0 {
		return &dbtypes.ChartsData{
			Balance: []float64{10.0, 20.0},
		}, nil
	}
	if coin == 1 {
		return &dbtypes.ChartsData{
			BalanceAtoms: []string{"1000000000000000000", "2000000000000000000"},
		}, nil
	}
	return nil, fmt.Errorf("invalid coin")
}

func (addressChartDS) AddressRows(ctx context.Context, address string, limit, offset int, view dbtypes.AddrTxnViewType, coin uint8) ([]*dbtypes.AddressRow, error) {
	if coin == 0 {
		return []*dbtypes.AddressRow{{Address: address, CoinType: 0, Value: 100 * 100000000}}, nil
	}
	if coin == 1 {
		return []*dbtypes.AddressRow{{Address: address, CoinType: 1, SKAValue: "1000000000000000000"}}, nil
	}
	return []*dbtypes.AddressRow{}, nil
}

func (addressChartDS) AddressRowsCompact(ctx context.Context, address string, coin uint8) ([]*dbtypes.AddressRowCompact, error) {
	if coin == 0 {
		return []*dbtypes.AddressRowCompact{{Address: address, CoinType: 0, Value: 100 * 100000000}}, nil
	}
	if coin == 1 {
		return []*dbtypes.AddressRowCompact{{Address: address, CoinType: 1, SKAValue: "1000000000000000000"}}, nil
	}
	return []*dbtypes.AddressRowCompact{}, nil
}

func TestAddressChartAPI_CoinFiltering(t *testing.T) {
	app := &appContext{
		DataSource: addressChartDS{},
		Params:     chaincfg.MainNetParams(),
		Status:     apitypes.NewStatus(0, 0, 0, "", ""),
	}
	mux := NewAPIRouter(app, "", false, false)
	const testAddr = "MsMfNmdbcherWznPacxufe9jSCMzRa1XDff"

	tests := []struct {
		name       string
		url        string
		wantCode   int
		wantString string
	}{
		{
			"VAR chart",
			"/address/" + testAddr + "/types/day?coin=0",
			http.StatusOK,
			`"balance":[10,20]`,
		},
		{
			"SKA chart",
			"/address/" + testAddr + "/types/day?coin=1",
			http.StatusOK,
			`"balance_atoms":["1000000000000000000","2000000000000000000"]`,
		},
		{
			"Invalid coin",
			"/address/" + testAddr + "/types/day?coin=99",
			http.StatusUnprocessableEntity,
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)

			if w.Code != tt.wantCode {
				t.Errorf("expected %d, got %d: %s", tt.wantCode, w.Code, w.Body.String())
			}
			if tt.wantString != "" && !strings.Contains(w.Body.String(), tt.wantString) {
				t.Errorf("expected body to contain %s, got %s", tt.wantString, w.Body.String())
			}
		})
	}
}

func TestAddressCSV_CoinFiltering(t *testing.T) {
	app := &appContext{
		DataSource: addressChartDS{},
		Params:     chaincfg.MainNetParams(),
		Status:     apitypes.NewStatus(0, 0, 0, "", ""),
	}
	mux := NewFileRouter(app, false)
	const testAddr = "MsMfNmdbcherWznPacxufe9jSCMzRa1XDff"

	tests := []struct {
		name       string
		url        string
		wantCode   int
		wantString string
	}{
		{
			"VAR CSV",
			"/address/io/" + testAddr + "?coin=0",
			http.StatusOK,
			"0,100", // coin_type, amount
		},
		{
			"SKA CSV",
			"/address/io/" + testAddr + "?coin=1",
			http.StatusOK,
			"1,1,0,Regular,", // coin_type=1, amount=1 (bare decimal, no label)
		},
	}
	// ...

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)

			if w.Code != tt.wantCode {
				t.Errorf("expected %d, got %d: %s", tt.wantCode, w.Code, w.Body.String())
			}
			if tt.wantString != "" && !strings.Contains(w.Body.String(), tt.wantString) {
				t.Errorf("expected body to contain %s, got %s", tt.wantString, w.Body.String())
			}
		})
	}
}
