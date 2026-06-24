package dcrpg

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/monetarium/monetarium-explorer/db/cache"
	"github.com/monetarium/monetarium-explorer/db/dcrpg/internal"
	"github.com/monetarium/monetarium-node/chaincfg"
)

func TestAppendMissedVotesPerWindow(t *testing.T) {
	ctx := context.Background()

	// overwrite_after_reorg verifies that a previously-tracked window's
	// MissedVotes entry is overwritten when the height-based cursor re-fetches
	// its blocks (as happens after ReorgHandler snipping + appendWindowStats).
	t.Run("overwrite_after_reorg", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()

		charts := cache.NewChartData(ctx, 0, chaincfg.MainNetParams())
		charts.DiffInterval = 5
		charts.Windows.Height = []uint64{0, 5}
		// Window 1 (index 1) has a stale pre-reorg tally.
		charts.Windows.MissedVotes = []uint64{10, 999}

		cursor := int32(charts.Windows.Height[len(charts.Windows.Height)-1]) - 1 // = 4
		mock.ExpectQuery(regexp.QuoteMeta(internal.SelectMissCountPerBlock)).
			WithArgs(cursor).
			WillReturnRows(sqlmock.NewRows([]string{"height", "count"}).
				AddRow(5, 2).
				AddRow(6, 1).
				AddRow(7, 0).
				AddRow(8, 0).
				AddRow(9, 2)) // window 1 total = 5

		rows, err := db.QueryContext(ctx, internal.SelectMissCountPerBlock, cursor)
		if err != nil {
			t.Fatalf("QueryContext: %v", err)
		}
		if err := appendMissedVotesPerWindow(charts, rows); err != nil {
			t.Fatalf("appendMissedVotesPerWindow: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet sqlmock expectations: %v", err)
		}

		if l := len(charts.Windows.MissedVotes); l != 2 {
			t.Errorf("MissedVotes length: want 2, got %d", l)
		}
		if got := charts.Windows.MissedVotes[1]; got != 5 {
			t.Errorf("MissedVotes[1]: want 5 (new chain tally), got %d", got)
		}
	})

	// provisional_entry_at_boundary verifies that when appendWindowStats has
	// added a new window (start-of-window semantics) but appendMissedVotesPerWindow
	// hasn't completed it yet (end-of-window semantics), a provisional 0 entry
	// keeps the lengths in sync and avoids Lengthen truncation.
	t.Run("provisional_entry_at_boundary", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()

		charts := cache.NewChartData(ctx, 0, chaincfg.MainNetParams())
		charts.DiffInterval = 5
		// appendWindowStats ran before this updater and added window 3 at
		// height 15. MissedVotes hasn't been updated yet — only 3 entries.
		charts.Windows.Height = []uint64{0, 5, 10, 15}
		charts.Windows.MissedVotes = []uint64{10, 5, 8}

		cursor := int32(charts.Windows.Height[len(charts.Windows.Height)-1]) - 1 // = 14
		mock.ExpectQuery(regexp.QuoteMeta(internal.SelectMissCountPerBlock)).
			WithArgs(cursor).
			WillReturnRows(sqlmock.NewRows([]string{"height", "count"}).
				AddRow(15, 0).
				AddRow(16, 0).
				AddRow(17, 0)) // window 3 not yet complete

		rows, err := db.QueryContext(ctx, internal.SelectMissCountPerBlock, cursor)
		if err != nil {
			t.Fatalf("QueryContext: %v", err)
		}
		if err := appendMissedVotesPerWindow(charts, rows); err != nil {
			t.Fatalf("appendMissedVotesPerWindow: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet sqlmock expectations: %v", err)
		}

		if l := len(charts.Windows.MissedVotes); l != 4 {
			t.Fatalf("MissedVotes length: want 4 (provisional entry kept in sync), got %d", l)
		}
		if got := charts.Windows.MissedVotes[3]; got != 0 {
			t.Errorf("MissedVotes[3] (provisional): want 0, got %d", got)
		}
	})

	// provisional_filled_on_window_end verifies that once the window completes,
	// the provisional 0 is replaced by the real missed-votes total.
	t.Run("provisional_filled_on_window_end", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()

		charts := cache.NewChartData(ctx, 0, chaincfg.MainNetParams())
		charts.DiffInterval = 5
		charts.Windows.Height = []uint64{0, 5, 10, 15}
		charts.Windows.MissedVotes = []uint64{10, 5, 8}

		cursor := int32(charts.Windows.Height[len(charts.Windows.Height)-1]) - 1 // = 14
		mock.ExpectQuery(regexp.QuoteMeta(internal.SelectMissCountPerBlock)).
			WithArgs(cursor).
			WillReturnRows(sqlmock.NewRows([]string{"height", "count"}).
				AddRow(15, 1).
				AddRow(16, 0).
				AddRow(17, 1).
				AddRow(18, 0).
				AddRow(19, 1)) // window 3 complete, total = 3

		rows, err := db.QueryContext(ctx, internal.SelectMissCountPerBlock, cursor)
		if err != nil {
			t.Fatalf("QueryContext: %v", err)
		}
		if err := appendMissedVotesPerWindow(charts, rows); err != nil {
			t.Fatalf("appendMissedVotesPerWindow: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet sqlmock expectations: %v", err)
		}

		if l := len(charts.Windows.MissedVotes); l != 4 {
			t.Fatalf("MissedVotes length: want 4, got %d", l)
		}
		if got := charts.Windows.MissedVotes[3]; got != 3 {
			t.Errorf("MissedVotes[3]: want 3 (final total), got %d", got)
		}
	})
}
