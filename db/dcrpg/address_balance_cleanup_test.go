package dcrpg

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/monetarium/monetarium-explorer/db/dcrpg/internal"
)

func TestAddressBalanceTransactionCleanup(t *testing.T) {
	for _, scenario := range []string{"canceled_iteration", "scan_error", "successful_commit"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			db.SetMaxOpenConns(1)
			mock.ExpectBegin()
			rows := sqlmock.NewRows([]string{"tx_type", "coin_type", "count", "value", "ska", "funding", "unmatched", "change"})
			switch scenario {
			case "canceled_iteration":
				rows.AddRow(0, 0, 1, 100, "0", true, true, false).RowError(0, context.Canceled)
			case "scan_error":
				rows.AddRow("invalid integer", 0, 1, 100, "0", true, true, false)
			case "successful_commit":
				rows.AddRow(0, 0, 1, 100, "0", true, true, false)
			}
			mock.ExpectQuery(regexp.QuoteMeta(internal.SelectAddressSpentUnspentCountAndValue)).
				WithArgs("test-address").WillReturnRows(rows).RowsWillBeClosed()
			if scenario == "successful_commit" {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			balance, err := retrieveAddressBalance(context.Background(), db, "test-address")
			if scenario == "successful_commit" {
				if err != nil {
					t.Fatal(err)
				}
				if balance == nil || balance.Coins[0] == nil || balance.Coins[0].TotalUnspent != 100 || balance.TotalOutputs != 1 {
					t.Fatalf("unexpected balance: %+v", balance)
				}
			} else if err == nil {
				t.Fatal("expected original query/scan error")
			} else if scenario == "canceled_iteration" && !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation not preserved: %v", err)
			}
			if inUse := db.Stats().InUse; inUse != 0 {
				t.Errorf("connection leaked: InUse=%d", inUse)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Error(err)
			}
		})
	}
}
