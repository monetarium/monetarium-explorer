package internal

import (
	"regexp"
	"strings"
	"testing"
)

// countParams counts the highest $N parameter in a SQL statement.
func countParams(sql string) int {
	re := regexp.MustCompile(`\$(\d+)`)
	matches := re.FindAllStringSubmatch(sql, -1)
	max := 0
	for _, m := range matches {
		var n int
		for _, c := range m[1] {
			n = n*10 + int(c-'0')
		}
		if n > max {
			max = n
		}
	}
	return max
}

// countColumns counts comma-separated column names in the INSERT column list.
func countColumns(sql string) int {
	// Extract the column list between first ( and first )
	start := strings.Index(sql, "(")
	end := strings.Index(sql, ")")
	if start < 0 || end < 0 || end <= start {
		return 0
	}
	cols := sql[start+1 : end]
	return len(strings.Split(cols, ","))
}

func TestInsertParamCounts(t *testing.T) {
	cases := []struct {
		name string
		sql  string
	}{
		{"insertVinRow", insertVinRow},
		{"insertVoutRow", insertVoutRow},
		{"insertTxRow", insertTxRow},
		{"insertAddressRow", insertAddressRow},
		{"InsertContractSpend", InsertContractSpend},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cols := countColumns(tc.sql)
			params := countParams(tc.sql)
			if cols != params {
				t.Errorf("%s: %d columns but max param is $%d", tc.name, cols, params)
			}
		})
	}
}

func TestNewColumnsPresent(t *testing.T) {
	checks := []struct {
		name string
		ddl  string
		col  string
	}{
		{"vins.coin_type", CreateVinTable, "coin_type INT2"},
		{"vouts.coin_type", CreateVoutTable, "coin_type INT2"},
		{"vouts.ska_value", CreateVoutTable, "ska_value TEXT"},
		{"transactions.ska_fees", CreateTransactionTable, "ska_fees JSONB"},
		{"addresses.coin_type", CreateAddressTable, "coin_type INT2"},
		{"addresses.ska_value", CreateAddressTable, "ska_value TEXT"},
		{"swaps.coin_type", CreateAtomicSwapTable, "coin_type INT2"},
		{"tickets.price TEXT", CreateTicketsTable, "price TEXT"},
		{"tickets.fee TEXT", CreateTicketsTable, "fee TEXT"},
		{"votes.ticket_price TEXT", CreateVotesTable, "ticket_price TEXT"},
		{"votes.vote_reward TEXT", CreateVotesTable, "vote_reward TEXT"},
	}
	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			if !strings.Contains(tc.ddl, tc.col) {
				t.Errorf("DDL for %s does not contain %q", tc.name, tc.col)
			}
		})
	}
}

func TestTreasuryTableRemoved(t *testing.T) {
	if strings.Contains(CreateTreasuryTable, "CREATE TABLE") {
		t.Error("CreateTreasuryTable should not create a real table")
	}
}

// countSelectColumns counts the columns in the SELECT list (between SELECT and FROM).
func countSelectColumns(sql string) int {
	upper := strings.ToUpper(sql)
	start := strings.Index(upper, "SELECT") + len("SELECT")
	end := strings.Index(upper, "FROM")
	if start < 0 || end < 0 || end <= start {
		return 0
	}
	cols := strings.TrimSpace(sql[start:end])
	return len(strings.Split(cols, ","))
}

func TestSelectColumnCounts(t *testing.T) {
	cases := []struct {
		name     string
		sql      string
		wantCols int
	}{
		{"SelectUTXOs", SelectUTXOs, 8},                                                       // id,tx_hash,tx_index,script_addresses,value,mixed,coin_type,ska_value
		{"SelectVoutAddressesByTxOut", SelectVoutAddressesByTxOut, 6},                         // id,script_addresses,value,mixed,coin_type,ska_value
		{"SelectFullTxByHash", SelectFullTxByHash, 24},                                        // id + 23 columns
		{"addrsColumnNames", "SELECT " + addrsColumnNames + " FROM x", 13},                    // id,address,...,coin_type,ska_value
		{"SelectAddressSpentUnspentCountAndValue", SelectAddressSpentUnspentCountAndValue, 6}, // is_regular,coin_type,count,sum,is_funding,all_empty_matching
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := countSelectColumns(tc.sql)
			if got != tc.wantCols {
				t.Errorf("%s: expected %d SELECT columns, got %d", tc.name, tc.wantCols, got)
			}
		})
	}
}

func TestCoinSupplyVARFilter(t *testing.T) {
	if !strings.Contains(SelectCoinSupply, "coin_type = 0") {
		t.Error("SelectCoinSupply must filter coin_type = 0 (VAR only)")
	}
}

func TestNumericCastOnTicketPrice(t *testing.T) {
	for _, sql := range []string{SelectTicketsForPriceAtLeast, SelectTicketsForPriceAtMost, SelectTicketsByPrice} {
		if !strings.Contains(sql, "::NUMERIC") {
			t.Errorf("ticket price query missing ::NUMERIC cast: %.60s", sql)
		}
	}
}
