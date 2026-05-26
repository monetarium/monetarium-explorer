# Technology Stack

Go backend split across 10 modules (see [structure.md](structure.md)). Hotwired Stimulus + Webpack frontend, rendered server-side from Go templates and progressively enhanced. PostgreSQL is the primary store; Badger is a side KV for the live ticket pool. Module paths and config keys retain `dcrdata` / `dcrd` naming from the upstream fork (`cmd/dcrdata/`, `dcrduser`, `dcrdserv`, `dcrdcert`, etc.) — load-bearing, do not rename.

## Backend

* **Language:** Go 1.23 (per `go.mod`; local toolchain may be newer).
* **HTTP routing:** `go-chi/chi/v5`.
* **Datastore:**
  * PostgreSQL via `lib/pq` — all indexed chain data, queries, charts.
  * Badger (`dgraph-io/badger`) — embedded KV holding the live ticket pool ([stakedb/](../../stakedb/)).
* **Chain RPC:** JSON-RPC client `monetarium-node/rpcclient`; types in `monetarium-node/rpc/jsonrpc/types`. Chain primitives — `chaincfg`, `dcrutil`, `wire`, `txscript/stdscript` — also from `monetarium-node`.
* **HTTP APIs:** two surfaces co-served on the same port:
  * `/api/...` — dcrdata-native ([cmd/dcrdata/internal/api/](../../cmd/dcrdata/internal/api/)).
  * `/insight/api/...` and `/insight/socket.io/` — Insight-compatible ([cmd/dcrdata/internal/api/insight/](../../cmd/dcrdata/internal/api/insight/)).
* **WebSockets:**
  * `github.com/coder/websocket` for the explorer (`/ws`) and pubsub (`/ps`) hubs, with RFC 6455 ping/pong keepalive.
  * `googollee/go-socket.io` for the Insight bridge (`/insight/socket.io/`).
  * `gorilla/websocket` only as the upstream exchange-rate client in [exchanges/](../../exchanges/).
* **High-precision arithmetic:** standard-library `math/big`. VAR has 8 decimals and fits `float64` (via `dcrutil.Amount.ToCoin()`); SKA has 18 decimals and stays as `big.Int`-derived strings end-to-end — no float conversion before the template boundary.

## Frontend

* **Bundler:** Webpack 5 (`webpack@5.76.3`) with four `.cjs` configs (`common`, `dev`, `prod`, `analyze`).
* **Controllers:** Stimulus 3 (`@hotwired/stimulus`). Multiple controllers per page is the norm — e.g. the home template attaches six (`time`, `home-latest-blocks`, `homepage`, `mining`, `supply`, `voting`) to a single container.
* **Navigation enhancement:** Turbolinks 5.2.0, **vendored** at [cmd/dcrdata/public/js/vendor/turbolinks.min.js](../../cmd/dcrdata/public/js/vendor/turbolinks.min.js). Not the newer Hotwire Turbo.
* **Templating:** server-side Go `html/template`, ~34 `.tmpl` files in [cmd/dcrdata/views/](../../cmd/dcrdata/views/), re-parsed on every request when started with `--reload-html`.
* **CSS:** SCSS via `sass` + `sass-loader` layered on Bootstrap 5 (`bootstrap@5.3.8`).
* **Charts:** Chart.js, vendored at [cmd/dcrdata/public/js/vendor/charts.min.js](../../cmd/dcrdata/public/js/vendor/charts.min.js).
* **Other notable runtime libs:** DOMPurify (HTML sanitization), Lodash-es (utilities), Mousetrap (keyboard shortcuts), qrcode (QR generation).

## Tooling

* **Go lint:** `golangci-lint` per [.golangci.yml](../../.golangci.yml). Enabled linters: `asciicheck`, `bidichk`, `durationcheck`, `errchkjson`, `govet`, `grouper`, `ineffassign`, `makezero`, `misspell`, `nilerr`, `nosprintfhostport`, `reassign`, `rowserrcheck`, `tparallel`, `unconvert`, `unparam`. Multi-module iteration order is pinned in [lint.sh](../../lint.sh) and [run_tests.sh](../../run_tests.sh) so that `go mod tidy` cascades correctly.
* **Go test build tags:** `pgonline`, `chartdata`, `fullpgdb` (see [run_tests.sh](../../run_tests.sh)). Without these, DB-backed paths are skipped; with them the script creates and drops a local `dcrdata_mainnet_test` Postgres database.
* **Frontend lint / format:** ESLint 9, Stylelint 16 (`stylelint-config-standard-scss`), Prettier 3.
* **Frontend test:** Vitest 4 with `environment: jsdom`; tests live next to source as `public/js/**/*.test.js`.
* **Pre-commit hooks:** install once via `./dev/install-hooks.sh`. Staged `*.go` files trigger `gofmt` check + per-module `go test`; staged `*.js` / `*.scss` trigger Prettier / ESLint / Stylelint / Vitest.

For CI/CD and container distribution, see [cicd.md](cicd.md). For repository layout and the 10-module workspace, see [structure.md](structure.md).
