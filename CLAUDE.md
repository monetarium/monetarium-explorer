# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Wiki — read this first

The repository ships a curated knowledge base in [wiki/](wiki/), indexed by [wiki/index.md](wiki/index.md) — start there to find what's available. It holds product scope and architecture, per-feature specs, and code-grounded traces of data flows and invariants for specific areas.

Use the wiki as the **primary reference for intent, architecture, and conventions**, but treat the **codebase as the source of truth for actual behavior** — if they conflict, follow the code and explicitly note the discrepancy. The wiki is not guaranteed to be current.

Before modifying code in an area covered by a code-analysis trace, **read that area's compact flow and patterns notes first** — they capture invariants the code alone won't reveal. If documentation is missing or inconsistent, say so rather than guessing.

## What this is

Block explorer for the Monetarium network. The codebase originated from `decred/dcrdata` (history was squashed into a single initial commit; **there is no git upstream and no ongoing sync** — treat this as a standalone codebase, not a fork). It supports the **multi-coin model** introduced by `monetarium-node`: VAR plus up to 255 SKA-type coins (`SKA1`, `SKA2`, …) — many places where the original dcrdata had a single value now carry per-coin-type maps/structs. Backend Go + PostgreSQL; frontend Webpack/SCSS with Hotwired Stimulus (no React).

**Key chain invariants** (these shape data structures all over the codebase — assume them when reading or writing tx-handling code):

- Monetarium is multi-coin, but **a single transaction is always single-coin**. There is no such thing as a mixed-coin transaction; every input and every output of a tx belongs to the same coin type.
- **Transaction fees are paid in the same coin as the transaction itself.** A VAR tx pays its fee in VAR; a SKA tx pays its fee in SKA. Don't write code that assumes fees are always VAR.

A lot of legacy `dcrdata` / `dcrd` naming still exists in code, paths, configs (e.g. `cmd/dcrdata/`, `dcrduser`, `dcrdserv`, `dcrdcert`). Don't rename it as a side quest — it's load-bearing across the codebase.

## Multi-module workspace (important)

This repo contains **8 separate Go modules**, not a single one. Tools that operate on the whole repo iterate them in a specific order so that `go mod tidy` cascades correctly:

```
./go.mod                          (root: blockdata, mempool, stakedb, pubsub, txhelpers, …)
./gov/go.mod
./db/dcrpg/go.mod
./cmd/dcrdata/go.mod              (the executable)
./pubsub/democlient/go.mod
./cmd/swapscan-btc/go.mod
./testutil/dbload/go.mod
./testutil/apiload/go.mod
```

The ordering is hardcoded in [lint.sh](lint.sh) and [run_tests.sh](run_tests.sh). When a change touches a low-level module (e.g. `txhelpers`), expect to run `go mod tidy` in dependent modules in this order. Build/lint/test commands must be run **from the relevant module's directory** — `go build ./...` at the repo root only sees the root module.

## Build

```sh
cd cmd/dcrdata
npm clean-install && npm run build      # bundle frontend assets first
go build -o monetarium-explorer .       # then the Go binary
```

The `public/` and `views/` folders must stay next to the binary at runtime.

## Test

- **Single package / module**: `cd <module> && go test ./...`
- **Single test**: `cd <module> && go test -run TestName ./pkg/...`
- **Whole repo**: `./run_tests.sh` — note it clones `dcrlabs/bug-free-happiness` into a temp dir for fixtures, and unpacks ticket-pool tarballs into `stakedb/`.
- **Build tags** for DB-backed tests: `TESTTAGS="pgonline" ./run_tests.sh`, `TESTTAGS="chartdata" ./run_tests.sh`, `TESTTAGS="pgonline fullpgdb" ./run_tests.sh`. With `pgonline` or `chartdata` the script creates/drops a local Postgres DB called `dcrdata_mainnet_test` (requires a working `psql -U postgres`) and runs `./testutil/dbload/dbload` to seed it.
- **Frontend tests** (vitest, jsdom env): `cd cmd/dcrdata && npm test`. Test files match `public/js/**/*.test.js`.

## Lint / format

```sh
./lint.sh                                       # golangci-lint across all modules
gofmt -l .  /  gofmt -w .                       # per directory
golangci-lint run -c .golangci.yml              # per module, from inside it
```

Frontend (from `cmd/dcrdata`): `npm run check` (= prettier + eslint + stylelint), `npm run format`, `npm run lint:fix`, `npm run lint:css:fix`.

Enabled Go linters are pinned in [.golangci.yml](.golangci.yml) (asciicheck, govet, ineffassign, makezero, misspell, nilerr, unconvert, unparam, …) — don't add new ones casually; the list was deliberately trimmed.

## Pre-commit hooks

Install once with `./dev/install-hooks.sh`. The hook only checks staged files:

- `*.go` → `gofmt` check + `go test ./...` on the affected module(s).
- `*.js` / `*.scss` → prettier check, eslint, stylelint, vitest.

If a hook blocks a commit, fix the underlying issue and create a new commit — don't `--amend` and don't `--no-verify` unless explicitly asked.

## Live development

Hot-reload paths to avoid restarting the Go server:

- `cd cmd/dcrdata && npm run watch` — watches JS/SCSS, rebuilds, updates `public/dist/manifest.json`. Hard-reload the browser.
- Run the binary with `--reload-html` — re-parses `views/*.tmpl` on every request.

Go source changes still require rebuild + restart.

## Architecture (big picture)

The data flow, from chain to user:

1. **`rpcutils`** wraps the `monetarium-node` JSON-RPC client.
2. **`blockdata`** is the primary collection/storage hub and chain monitor — it consumes new-block notifications and fans data out to subscribers.
3. **`db/dcrpg`** is the PostgreSQL backend (large package: schema, indexing, sync, charts, queries, upgrades). **`db/cache`** sits in front of it. **`db/dbtypes`** holds shared row/struct types.
4. **`stakedb`** maintains the live ticket pool in a Badger KV store (separate from Postgres).
5. **`mempool`** monitors mempool txs and emits typed events.
6. **`txhelpers`** is the central place for tx/block parsing and reward math (`RewardsAtBlock`, `BlockSSFeeTotals`). Reward calc is non-obvious — see [wiki/core/staking-rewards.md](wiki/core/staking-rewards.md) (sections 3.1–3.2) for the multi-coin (VAR + SKA{n}) model before changing anything in this area.
7. **`pubsub`** is the websocket pub/sub server — same data, push-style. Note: parts of the home-page reward calc are duplicated here (`pubsub/pubsubhub.go`) and in the explorer; if you change one, check the other.
8. **`gov/agendas`** and **`gov/politeia`** are governance DBs (consensus deployments + proposals).
9. **`cmd/dcrdata`** is the executable that wires everything together.

Inside `cmd/dcrdata`:

- [main.go](cmd/dcrdata/main.go) constructs the dependency graph in `_main()`.
- `internal/notification` — bridges `dcrd`-style notifications into synchronous collection.
- `internal/explorer` — HTML pages, websocket handlers, home viewmodel.
- `internal/api` — the dcrdata HTTP API (`/api/...`).
- `internal/api/insight` — the Insight-compatible API (`/insight/api/...`).
- `internal/middleware` — chi router middleware.
- `views/*.tmpl` — Go HTML templates rendered by `internal/explorer`.
- `public/` — frontend source (`scss/`, `js/` Stimulus controllers, `index.js` entry); `public/dist/` is the webpack output.

Both APIs are served on the same port (default 7777). Endpoints accept `?indent=true` for pretty JSON.

## Conventions to know

- **Exported names matter for tests/mocks**: e.g. `SkaCoinType` (exported) vs an unexported variant — past commits had to switch references and update mocks together. When you add anything coin-type-related, check `blockdata/`, `db/dcrpg/`, and `txhelpers/` mocks/fakes for matching updates.
- **Cumulative vs per-block series**: SKA supply charts use cumulative supply aligned to block height (see recent commits on `test/ska-coin-supply-charts`). When adding new time-axis chart endpoints, include the `h` (height) field for alignment.
- **Precision**: VAR uses 8 decimals — fits safely in `float64`, which is why `dcrutil.Amount.ToCoin() float64` is used for VAR throughout the codebase. SKA uses 18 decimals — **exceeds `float64`'s significand**, so SKA atoms must stay as `big.Int`-derived strings end-to-end (no `.ToCoin()` equivalent; no float conversion before the template boundary). Formatting helpers live in the explorer (`float64AsDecimalParts`, `FormatSKAPerVAR`, `FormatSKAAtoms`). Don't print raw atoms.
- **PR/Issue title format**: `package/path: concise description`, e.g. `db/dcrpg: charts data updates could use incremental changes`.

## Configuration

Default config dir is `~/.monetarium-explorer/` (macOS: `~/Library/Application Support/Monetarium-explorer/`). The node it talks to lives at `~/.monetarium/` (macOS: `~/Library/Application Support/Monetarium/`). Sample config: [cmd/dcrdata/sample-dcrdata.conf](cmd/dcrdata/sample-dcrdata.conf). All flags: `./monetarium-explorer --help`.

Local testnet ports: node P2P 19508, node RPC 19509, explorer web/API 17778.
