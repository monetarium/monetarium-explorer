package dcrpg

import (
	"context"
	"database/sql"
	"errors"
	"runtime"
	"sync"
	"time"

	"github.com/lib/pq"
)

// poolDiagnostics is owned by the monitor goroutine. Historical waits alone do
// not indicate current pressure. Sampling never acquires a SQL connection.
type poolDiagnostics struct {
	previous sql.DBStats
	lastLog  time.Time
	pressure bool
}

func (p *poolDiagnostics) observe(now time.Time, stats sql.DBStats) string {
	waiting := stats.WaitCount > p.previous.WaitCount
	saturated := stats.MaxOpenConnections > 0 && stats.InUse >= stats.MaxOpenConnections && stats.Idle == 0
	p.previous = stats
	if saturated || waiting {
		first := !p.pressure
		p.pressure = true
		if first || now.Sub(p.lastLog) >= time.Minute {
			p.lastLog = now
			return "pressure"
		}
		return ""
	}
	if p.pressure {
		p.pressure = false
		p.lastLog = now
		return "recovered"
	}
	if now.Sub(p.lastLog) >= 5*time.Minute {
		p.lastLog = now
		return "heartbeat"
	}
	return ""
}

func monitorPool(ctx context.Context, db *sql.DB, ticks <-chan time.Time) {
	previous := db.Stats()
	monitor := poolDiagnostics{previous: previous, lastLog: time.Now()}
	for {
		select {
		case <-ctx.Done():
			return
		case now, ok := <-ticks:
			if !ok {
				return
			}
			stats := db.Stats()
			event := monitor.observe(now, stats)
			if event == "" {
				continue
			}
			format := "DB pool event=%s max=%d open=%d in_use=%d idle=%d wait_count=%d wait_duration=%s wait_count_since_log=%d wait_duration_since_log=%s goroutines=%d"
			if event == "pressure" {
				log.Warnf(format, event, stats.MaxOpenConnections, stats.OpenConnections,
					stats.InUse, stats.Idle, stats.WaitCount, stats.WaitDuration,
					stats.WaitCount-previous.WaitCount, stats.WaitDuration-previous.WaitDuration, runtime.NumGoroutine())
			} else {
				log.Infof(format, event, stats.MaxOpenConnections, stats.OpenConnections,
					stats.InUse, stats.Idle, stats.WaitCount, stats.WaitDuration,
					stats.WaitCount-previous.WaitCount, stats.WaitDuration-previous.WaitDuration, runtime.NumGoroutine())
			}
			previous = stats
		}
	}
}

func (pgb *ChainDB) startPoolMonitor() {
	ctx, cancel := context.WithCancel(pgb.ctx)
	pgb.poolMonitorCancel = cancel
	pgb.poolMonitorDone = make(chan struct{})
	go func() {
		defer close(pgb.poolMonitorDone)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		monitorPool(ctx, pgb.db, ticker.C)
	}()
}

// Only allowlisted classifications are logged: driver error messages may
// contain SQL, addresses, or connection details.
func diagnosticError(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline_exceeded"
	}
	var pgErr *pq.Error
	if errors.As(err, &pgErr) {
		code := string(pgErr.Code)
		if len(code) == 5 {
			valid := true
			for _, c := range code {
				valid = valid && (c >= '0' && c <= '9' || c >= 'A' && c <= 'Z')
			}
			if valid {
				return "sqlstate_" + code
			}
		}
	}
	return "other"
}

type diagnosticLimit struct {
	last       time.Time
	suppressed uint64
}

// Keys are fixed stage names, never request data. The mutex is not held during
// logging, database work, or any other external operation.
var balanceDiagnosticLimits = struct {
	sync.Mutex
	stages map[string]diagnosticLimit
}{stages: make(map[string]diagnosticLimit)}

func logBalanceFailure(ctx context.Context, db *sql.DB, stage string, started, stageStarted time.Time, err error) {
	if err == nil {
		return
	}
	now := time.Now()
	balanceDiagnosticLimits.Lock()
	limit := balanceDiagnosticLimits.stages[stage]
	if !limit.last.IsZero() && now.Sub(limit.last) < time.Minute {
		limit.suppressed++
		balanceDiagnosticLimits.stages[stage] = limit
		balanceDiagnosticLimits.Unlock()
		return
	}
	suppressed := limit.suppressed
	balanceDiagnosticLimits.stages[stage] = diagnosticLimit{last: now}
	balanceDiagnosticLimits.Unlock()
	stats := db.Stats()
	log.Warnf("DB operation=address_balance stage=%s elapsed=%s stage_elapsed=%s error_class=%s context=%s max=%d open=%d in_use=%d idle=%d wait_count=%d wait_duration=%s suppressed=%d",
		stage, now.Sub(started), now.Sub(stageStarted), diagnosticError(err), diagnosticError(ctx.Err()),
		stats.MaxOpenConnections, stats.OpenConnections, stats.InUse, stats.Idle,
		stats.WaitCount, stats.WaitDuration, suppressed)
}
