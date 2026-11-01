# `package dcrpg`

The `dcrpg` package provides types and functions for manipulating PostgreSQL
tables, and storing blocks, transactions, inputs, and outputs.

## Supported Database Software

PostgreSQL versions 10.5 to 11.x are fully supported. The bulk of the testing
and performance optimization is done with PostgreSQL in mind.

## Performance and Bulk Loading

When performing a bulk data import, it is wise to first drop any existing
indexes and create them again after insertion is completed.  Functions are
provided to create and drop the indexes.

PostgreSQL performance will be poor, particularly during bulk import, unless
synchronous transaction commits are disabled via the `synchronous_commit = off`
configuration setting in your postgresql.conf. There are numerous
[PostreSQL tuning settings](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server),
but a quick suggestion for your system can be provided
by[PgTune](http://pgtune.leopard.in.ua/). During [initial table
population](https://wiki.postgresql.org/wiki/Bulk_Loading_and_Restores), it is
also OK to turn off full page writes, and possibly fsync, but change these
two options back after initial sync.

Especially during normal operation, it is important to set `autovacuum = on`.
For fast queries, it is critical to have regular table statistics collected by
the autovacuum process.

## Outage diagnostics

The existing `PSQL` logger reports connection-pool diagnostics automatically:

- Every 10 seconds, a background monitor samples `sql.DB.Stats()` without
  acquiring a database connection or issuing SQL. Pool saturation or newly
  queued connection acquisitions produce `DB pool event=pressure` warnings,
  at most once per minute, including when pressure and healthy samples alternate.
- `event=recovered` means the sampled pool is no longer saturated and no new
  waits were recorded during that sample interval, following a reported pressure
  warning. Suppressed pressure episodes do not generate recovery messages. It does not prove all
  database operations are healthy. A healthy `event=heartbeat` appears every
  five minutes at INFO, so historical counters and process liveness can be
  compared before and during an incident.
- Fields include `max`, `open`, `in_use`, `idle`, cumulative `wait_count` and
  `wait_duration`, their changes since the previous pool log, and the current
  goroutine count. Wait duration can lag while acquisitions are still waiting.
  `in_use=max` with zero idle connections demonstrates pool saturation, not
  whether it was caused by leaked transactions, slow SQL, or another holder.
- Failed address-balance operations add `operation=address_balance`, `stage`,
  total and stage elapsed times (scan failures retain the row-iteration start),
  allowlisted `error_class`, caller `context`,
  and pool counters. Stages distinguish transaction acquisition, query, scan,
  row iteration, and commit. These warnings are limited to once per minute per
  stage; `suppressed` counts omitted diagnostics since the previous stage log.
  Existing error logs are unchanged and are not throttled by this limiter.

New diagnostics never include addresses, SQL, connection strings, driver error
messages, or stack dumps. They use the existing logging destination and levels;
keep PSQL INFO enabled to retain heartbeats and recovery messages.

This instrumentation does not change query timeouts or transaction cleanup.
In particular, an operation blocked in transaction acquisition with a background
context cannot emit its failure diagnostic until it returns; the independent
pool monitor can still expose saturation. A blocked logging destination can
also prevent these messages from being written.
Shutdown waits at most one second for the monitor before closing the database;
an in-flight write to a stalled logging destination may outlive that wait.

During another incident, preserve these logs alongside nginx upstream errors
and PostgreSQL session/wait information before restarting. Pool snapshots help
identify resource pressure, but attributing it to a specific connection holder
may still require a goroutine dump and PostgreSQL activity inspection. No new
diagnostic HTTP endpoint or automatic production query is introduced.
