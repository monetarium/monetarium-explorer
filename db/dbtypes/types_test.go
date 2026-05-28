package dbtypes

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/monetarium/monetarium-explorer/txhelpers"
)

const (
	trefUNIX = 1454954400
	trefStr  = "2016-02-08T12:00:00-06:00"
)

var (
	// Two times in different locations for the same instant in time.
	trefLocal = time.Unix(trefUNIX, 0).Local()
	trefUTC   = time.Unix(trefUNIX, 0).UTC()
)

func TestTimeDefMarshal(t *testing.T) {
	tref := time.Unix(trefUNIX, 0)
	trefJSON := `"` + tref.Format(timeDefFmtJS) + `"`
	t.Log(trefJSON)

	timedef := &TimeDef{
		T: tref,
	}
	jsonTime, err := timedef.MarshalJSON()
	if err != nil {
		t.Errorf("MarshalJSON failed: %v", err)
	}

	if string(jsonTime) != trefJSON {
		t.Errorf("expected %s, got %s", trefJSON, string(jsonTime))
	}
}

func TestNewTimeDef(t *testing.T) {
	// Create a time with Local location.
	tref, err := time.Parse(time.RFC3339, trefStr)
	if err != nil {
		t.Error(err)
	}
	tref = tref.Local()

	// Create the TimeDef, and verify that the location is now UTC.
	td := NewTimeDef(tref)
	if td.T.Location() != time.UTC {
		t.Errorf("NewTimeDef should return a time in UTC (not local).")
	}

	t.Log(td)
}

func TestTimeDef_Value(t *testing.T) {
	// Create the TimeDef from a Local time.
	td := NewTimeDef(trefLocal)
	// Verify the Location of the time returned by Value is UTC.
	tdSqlValue, _ := td.Value()
	tdSqlTime, ok := tdSqlValue.(time.Time)
	if !ok {
		t.Error("not a time.Time")
	}
	t.Log(tdSqlTime)
	if tdSqlTime.Location() != time.UTC {
		t.Errorf("TimeDef.Value should return a UTC time.")
	}

	// Create the TimeDef from the equivalent time in UTC.
	td2 := NewTimeDef(trefUTC)
	// Verify the Location of the time returned by Value is UTC.
	tdSqlValue2, _ := td2.Value()
	tdSqlTime2, ok := tdSqlValue2.(time.Time)
	if !ok {
		t.Error("not a time.Time")
	}
	t.Log(tdSqlTime2)
	if tdSqlTime2.Location() != time.UTC {
		t.Errorf("TimeDef.Value should return a UTC time.")
	}

	// Verify the string formats of the time.Time are the same.
	if tdSqlTime.String() != tdSqlTime2.String() {
		t.Errorf("time strings do not match: %s != %s",
			tdSqlTime.String(), tdSqlTime2.String())
	}
}

func TestCoinBalanceJSON(t *testing.T) {
	tests := []struct {
		name     string
		balance  *CoinBalance
		expected string
	}{
		{
			"VAR balance",
			&CoinBalance{
				CoinType:      0,
				NumSpent:      10,
				NumUnspent:    20,
				TotalSpent:    100000000,
				TotalUnspent:  200000000,
				TotalReceived: 300000000,
			},
			`{"coin_type":0,"num_spent":10,"num_unspent":20,"total_spent":100000000,"total_unspent":200000000,"total_received":300000000}`,
		},
		{
			"SKA balance",
			&CoinBalance{
				CoinType:         1,
				NumSpent:         5,
				NumUnspent:       15,
				TotalSpentSKA:    "5000000000000000000",
				TotalUnspentSKA:  "15000000000000000000",
				TotalReceivedSKA: "20000000000000000000",
			},
			`{"coin_type":1,"num_spent":5,"num_unspent":15,"total_spent_ska":"5000000000000000000","total_unspent_ska":"15000000000000000000","total_received_ska":"20000000000000000000"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.balance)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}
			if string(data) != tt.expected {
				t.Errorf("expected %s, got %s", tt.expected, string(data))
			}

			var decoded CoinBalance
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}
			if decoded.CoinType != tt.balance.CoinType {
				t.Errorf("expected CoinType %d, got %d", tt.balance.CoinType, decoded.CoinType)
			}
		})
	}
}

func TestChartsDataJSON(t *testing.T) {
	cd := &ChartsData{
		Balance:       []float64{1.0, 2.0},
		BalanceAtoms:  []string{"1000000000000000000", "2000000000000000000"},
		ReceivedAtoms: []string{"1000000000000000000", "1000000000000000000"},
		SentAtoms:     []string{"0", "0"},
		NetAtoms:      []string{"1000000000000000000", "2000000000000000000"},
	}

	data, err := json.Marshal(cd)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded ChartsData
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if len(decoded.BalanceAtoms) != 2 || decoded.BalanceAtoms[1] != "2000000000000000000" {
		t.Errorf("BalanceAtoms failed: got %v", decoded.BalanceAtoms)
	}
}

func TestTimeDef_Scan(t *testing.T) {

	// Scan the reference time with Local Location.
	var td TimeDef
	err := td.Scan(trefLocal)
	if err != nil {
		t.Fatal(err)
	}

	// TimeDef.T location should be stored as UTC.
	if td.T.Location() != time.UTC {
		t.Errorf("TimeDef.Value should return a UTC time.")
	}

	t.Log(td)

	// Scan the reference time with UTC Location.
	var td2 TimeDef
	err = td2.Scan(trefUTC)
	if err != nil {
		t.Fatal(err)
	}

	// TimeDef.T location should be stored as UTC.
	if td2.T.Location() != time.UTC {
		t.Errorf("TimeDef.Value should return a UTC time.")
	}

	t.Log(td)

	// Ensure they are the same instant in time.
	if td.T.Unix() != td2.T.Unix() {
		t.Logf("unix epoch times do not match: %d != %d",
			td.T.Unix(), td2.T.Unix())
	}

	// Verify the string formats of the time.Time are the same.
	if td.T.String() != td2.T.String() {
		t.Errorf("time strings do not match: %s != %s",
			td.T.String(), td2.T.String())
	}

	// Scan with an unsupported type.
	var td3 TimeDef
	err = td3.Scan(trefUNIX)
	if err == nil {
		t.Fatal("TimeDef.Scan(int64) should have failed")
	}
}

func TestChainHashArray2_Value(t *testing.T) {
	tests := []struct {
		name    string
		a       ChainHashArray2
		want    string
		wantErr bool
	}{
		{
			"ok",
			ChainHashArray2{ChainHash{1, 2, 3}, ChainHash{4, 5, 6}},
			`{"\\x0000000000000000000000000000000000000000000000000000000000030201","\\x0000000000000000000000000000000000000000000000000000000000060504"}`,
			false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.a.Value()
			if (err != nil) != tt.wantErr {
				t.Errorf("ChainHashArray2.Value() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("Want =  \"%s\", got = \"%s\"", tt.want, got)
			}
		})
	}
}

func TestReduceAddressHistory_SKA(t *testing.T) {
	rows := []*AddressRow{
		{
			Address:        "MsTest",
			TxHash:         ChainHash{1},
			ValidMainChain: true,
			IsFunding:      true,
			CoinType:       1,
			Value:          0,
			SKAValue:       "1000000000000000000",
		},
	}
	ai, _, _ := ReduceAddressHistory(rows)
	if ai == nil || len(ai.Transactions) == 0 {
		t.Fatal("expected one transaction")
	}
	tx := ai.Transactions[0]
	if tx.SKAValue != "1000000000000000000" {
		t.Errorf("SKAValue: want 1000000000000000000, got %q", tx.SKAValue)
	}
	if tx.ReceivedTotal != 0 {
		t.Errorf("ReceivedTotal must be 0 for SKA row, got %v", tx.ReceivedTotal)
	}
	if tx.CoinType != 1 {
		t.Errorf("CoinType: want 1, got %d", tx.CoinType)
	}
	// VAR totals must be unaffected
	if ai.AmountReceived != 0 {
		t.Errorf("AmountReceived must be 0 for SKA-only history, got %v", ai.AmountReceived)
	}
}

func TestReduceAddressHistory_MixedCoin(t *testing.T) {
	rows := []*AddressRow{
		{
			Address:        "MixedAddr",
			TxHash:         ChainHash{1},
			ValidMainChain: true,
			IsFunding:      true,
			CoinType:       0,
			Value:          5000000000, // 50 VAR
		},
		{
			Address:        "MixedAddr",
			TxHash:         ChainHash{2},
			ValidMainChain: true,
			IsFunding:      true,
			CoinType:       1,
			SKAValue:       "1000000000000000000", // 1 SKA receive
		},
		{
			Address:        "MixedAddr",
			TxHash:         ChainHash{4},
			ValidMainChain: true,
			IsFunding:      true,
			CoinType:       1,
			SKAValue:       "2000000000000000000", // 2 SKA receive (tests sum, not overwrite)
		},
		{
			Address:        "MixedAddr",
			TxHash:         ChainHash{5},
			ValidMainChain: true,
			IsFunding:      false,
			CoinType:       1,
			SKAValue:       "500000000000000000", // 0.5 SKA spend
		},
		{
			Address:        "MixedAddr",
			TxHash:         ChainHash{3},
			ValidMainChain: true,
			IsFunding:      false,
			CoinType:       0,
			Value:          2000000000, // 20 VAR
		},
	}
	ai, _, _ := ReduceAddressHistory(rows)
	if ai == nil {
		t.Fatal("expected AddressInfo")
	}

	if len(ai.ActiveCoins) != 2 {
		t.Errorf("ActiveCoins: want [0, 1], got %v", ai.ActiveCoins)
	}
	if ai.ActiveCoins[0] != 0 || ai.ActiveCoins[1] != 1 {
		t.Errorf("ActiveCoins not sorted: got %v", ai.ActiveCoins)
	}

	coins := ai.Balance.Coins
	if len(coins) != 2 {
		t.Errorf("Coins map: want 2 entries, got %d", len(coins))
	}

	varCoin := coins[0]
	if varCoin.TotalSpent != 2000000000 {
		t.Errorf("VAR TotalSpent: want 2000000000, got %d", varCoin.TotalSpent)
	}
	if varCoin.TotalUnspent != 3000000000 {
		t.Errorf("VAR TotalUnspent: want 3000000000, got %d", varCoin.TotalUnspent)
	}
	if varCoin.TotalReceived != 5000000000 {
		t.Errorf("VAR TotalReceived: want 5000000000, got %d", varCoin.TotalReceived)
	}
	if varCoin.TotalSpentSKA != "" {
		t.Errorf("VAR TotalSpentSKA should be empty, got %q", varCoin.TotalSpentSKA)
	}

	skaCoin := coins[1]
	// TotalReceivedSKA = 1e18 + 2e18 = 3e18
	if skaCoin.TotalReceivedSKA != "3000000000000000000" {
		t.Errorf("SKA TotalReceivedSKA: want 3000000000000000000, got %q", skaCoin.TotalReceivedSKA)
	}
	// TotalSpentSKA = 0.5e18
	if skaCoin.TotalSpentSKA != "500000000000000000" {
		t.Errorf("SKA TotalSpentSKA: want 500000000000000000, got %q", skaCoin.TotalSpentSKA)
	}
	// TotalUnspentSKA = 3e18 - 0.5e18 = 2.5e18
	if skaCoin.TotalUnspentSKA != "2500000000000000000" {
		t.Errorf("SKA TotalUnspentSKA: want 2500000000000000000, got %q", skaCoin.TotalUnspentSKA)
	}
}

// TestFormatSKACoins covers the label-free SKA atoms→coins formatter used by
// the CSV export (the amount column must be a bare parseable number, with the
// coin disambiguated by the separate coin_type column).
func TestFormatSKACoins(t *testing.T) {
	cases := []struct {
		atoms string
		want  string
	}{
		{"", "0"},
		{"not-a-number", "0"},
		{"0", "0"},
		{"500", "0.0000000000000005"},
		{"70000000", "0.00000000007"},
		{"1000000000000000000", "1"},
		{"5000000000000000000000", "5000"},
		{"1230000000000000000", "1.23"},
	}
	for _, c := range cases {
		if got := FormatSKACoins(c.atoms); got != c.want {
			t.Errorf("FormatSKACoins(%q) = %q, want %q", c.atoms, got, c.want)
		}
	}
}

// TestTxTypeToString_MatchesDBExtensions asserts that txhelpers.TxTypeToString
// correctly maps the canonical db/dbtypes extension constants (101–105) to the
// expected display strings. If a db/dbtypes constant value changes, this test
// fails and signals that txhelpers must be updated too.
func TestTxTypeToString_MatchesDBExtensions(t *testing.T) {
	tests := []struct {
		dbValue int16
		want    string
	}{
		{TxTypeBlockRewardPoS, "Stake Reward"},
		{TxTypeBlockRewardPoW, "PoW Reward"},
		{TxTypeSSFeePoS, "Stake Fee"},
		{TxTypeSSFeePoW, "Stake Fee"},
		{TxTypeTicketPurchase, "Ticket"},
	}
	for _, tt := range tests {
		got := txhelpers.TxTypeToString(int(tt.dbValue))
		if got != tt.want {
			t.Errorf("TxTypeToString(%d) = %q, want %q", tt.dbValue, got, tt.want)
		}
	}
}
