package dbtypes

import (
	"testing"
	"time"
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

	// Verify the instants in time are the same.
	if tdSqlTime.Unix() != tdSqlTime2.Unix() {
		t.Logf("unix epoch times do not match: %d != %d",
			tdSqlTime.Unix(), tdSqlTime2.Unix())
	}

	// Create the TimeDef from a Local time, but do not use the constructor.
	// This shows that Value will ensure the correct time.Time in UTC for sql
	// regardless of the location of TimeDef.T.
	td3 := TimeDef{T: trefLocal}
	// Verify the Location of the time returned by Value is UTC.
	tdSqlValue3, _ := td3.Value()
	tdSqlTime3, ok := tdSqlValue3.(time.Time)
	if !ok {
		t.Error("not a time.Time")
	}
	t.Log(tdSqlTime3)
	if tdSqlTime3.Location() != time.UTC {
		t.Errorf("TimeDef.Value should return a UTC time.")
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
			Value:          0,
			SKAValue:       "1000000000000000000", // 1 SKA
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
	if skaCoin.TotalSpent != 0 {
		t.Errorf("SKA TotalSpent: want 0, got %d", skaCoin.TotalSpent)
	}
	if skaCoin.TotalUnspent != 0 {
		t.Errorf("SKA TotalUnspent should be 0 (int64), got %d", skaCoin.TotalUnspent)
	}
	if skaCoin.TotalUnspentSKA != "1000000000000000000" {
		t.Errorf("SKA TotalUnspentSKA: want 1000000000000000000, got %q", skaCoin.TotalUnspentSKA)
	}
	if skaCoin.TotalReceivedSKA != "1000000000000000000" {
		t.Errorf("SKA TotalReceivedSKA: want 1000000000000000000, got %q", skaCoin.TotalReceivedSKA)
	}
}
