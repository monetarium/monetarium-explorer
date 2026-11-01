package dcrpg

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/decred/slog"
	"github.com/lib/pq"
)

func TestPoolDiagnostics(t *testing.T) {
	start := time.Unix(1000, 0)
	healthy := sql.DBStats{MaxOpenConnections: 25, OpenConnections: 10, InUse: 2, Idle: 8}
	full := sql.DBStats{MaxOpenConnections: 25, OpenConnections: 25, InUse: 25}
	monitor := poolDiagnostics{previous: healthy, lastLog: start}
	cases := []struct {
		name  string
		after time.Duration
		stats sql.DBStats
		want  string
	}{
		{"healthy silent", time.Second, healthy, ""},
		{"saturation", 10 * time.Second, full, "pressure"},
		{"throttled", 20 * time.Second, full, ""},
		{"persistent pressure", 70 * time.Second, full, "pressure"},
		{"recovery", 80 * time.Second, healthy, "recovered"},
		{"healthy heartbeat", 380 * time.Second, healthy, "heartbeat"},
		{"new waits", 390 * time.Second, sql.DBStats{MaxOpenConnections: 25, WaitCount: 1}, "pressure"},
		{"historical waits recover", 400 * time.Second, sql.DBStats{MaxOpenConnections: 25, WaitCount: 1}, "recovered"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := monitor.observe(start.Add(tt.after), tt.stats); got != tt.want {
				t.Fatalf("event = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBalanceFailureLogging(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var output bytes.Buffer
	previousLog := log
	log = slog.NewBackend(&output).Logger("PSQL")
	log.SetLevel(slog.LevelTrace)
	defer func() { log = previousLog }()
	balanceDiagnosticLimits.Lock()
	previousLimits := balanceDiagnosticLimits.stages
	balanceDiagnosticLimits.stages = make(map[string]diagnosticLimit)
	balanceDiagnosticLimits.Unlock()
	defer func() {
		balanceDiagnosticLimits.Lock()
		balanceDiagnosticLimits.stages = previousLimits
		balanceDiagnosticLimits.Unlock()
	}()

	mock.ExpectBegin().WillReturnError(errors.New("private payload"))
	_, gotErr := retrieveAddressBalance(context.Background(), db, "private address")
	if gotErr == nil || !strings.Contains(gotErr.Error(), "private payload") {
		t.Fatalf("original error was changed: %v", gotErr)
	}
	text := output.String()
	for _, field := range []string{"operation=address_balance", "stage=begin_tx", "error_class=other", "context=none", "in_use=", "wait_count=", "suppressed=0"} {
		if !strings.Contains(text, field) {
			t.Errorf("missing %q in %s", field, text)
		}
	}
	if strings.Contains(text, "private") {
		t.Fatalf("sensitive payload logged: %s", text)
	}
	output.Reset()
	now := time.Now()
	logBalanceFailure(context.Background(), db, "begin_tx", now, now, context.Canceled)
	if output.Len() != 0 {
		t.Fatal("repeated failure not throttled")
	}
	balanceDiagnosticLimits.Lock()
	limit := balanceDiagnosticLimits.stages["begin_tx"]
	limit.last = now.Add(-2 * time.Minute)
	balanceDiagnosticLimits.stages["begin_tx"] = limit
	balanceDiagnosticLimits.Unlock()
	logBalanceFailure(context.Background(), db, "begin_tx", now, now, context.Canceled)
	if !strings.Contains(output.String(), "suppressed=1") {
		t.Fatalf("missing suppressed count: %s", output.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPoolMonitorShutdown(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	pgb := &ChainDB{ctx: ctx, db: db}
	pgb.startPoolMonitor()
	cancel()
	select {
	case <-pgb.poolMonitorDone:
	case <-time.After(5 * time.Second):
		t.Fatal("monitor did not stop with parent context")
	}
	// Close also stops a monitor whose parent is still live.
	pgb.ctx = context.Background()
	pgb.startPoolMonitor()
	mock.ExpectClose()
	closed := make(chan error, 1)
	go func() { closed <- pgb.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not return")
	}
	select {
	case <-pgb.poolMonitorDone:
	default:
		t.Fatal("Close returned before monitor stopped")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestBalanceDiagnosticError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"canceled", context.Canceled, "canceled"},
		{"deadline", context.DeadlineExceeded, "deadline_exceeded"},
		{"postgres", &pq.Error{Code: "57014", Message: "private SQL payload"}, "sqlstate_57014"},
		{"redacted", errors.New("private address and credentials"), "other"},
		{"none", nil, "none"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := diagnosticError(tt.err); got != tt.want {
				t.Fatalf("classification = %q, want %q", got, tt.want)
			}
		})
	}
}
