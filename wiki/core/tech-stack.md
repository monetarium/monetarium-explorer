# Technology Stack

Monetarium Explorer bridges rigorous Go multi-module architectures with frontend Javascript SPA concepts over a dynamic Postgres database layer.

## Foundation & Backend
* **Language:** Go 1.23
* **Routing:** `go-chi/chi/v5`
* **Datastore:** 
  * PostgreSQL `lib/pq` (General Chain Storage)
  * Badger (Embedded KV for fast stake analysis)
* **High-Precision Logic:** Standard-library `math/big` (`big.Int`, `big.Float`). VAR has 8 decimals and fits `float64` (via `dcrutil.Amount.ToCoin()`); SKA has 18 decimals and stays as `big.Int`-derived strings end-to-end (no float conversion).
* **RPC Layer:** JSON-RPC client `monetarium-node/rpcclient` against `monetarium-node`, with types in `monetarium-node/rpc/jsonrpc/types`. (gRPC + protobuf are only used by the separate exchange-rate service in `exchanges/rateserver/`.)
* **WebSockets:**
  * `github.com/coder/websocket` for the explorer (`/ws`) and pubsub (`/ps`) hubs, with RFC 6455 ping/pong keepalive.
  * `googollee/go-socket.io` for the Insight compatibility bridge (`/insight/socket.io/`).
  * `gorilla/websocket` only as the upstream exchange-rate client in `exchanges/`.

## Frontend
* **Build Engine:** Webpack 5 (Configs handled by `.cjs` split environments)
* **DOM Controllers:** Stimulus 3 (`@hotwired/stimulus`). Multiple controllers per page are common — e.g. the home template attaches six (`time`, `home-latest-blocks`, `homepage`, `mining`, `supply`, `voting`) to a single container.
* **SPA Orchestrator:** Turbolinks 5.2.0 (Note: specifically skipped Hotwire Turbo upgrades in favor of vendored turbolinks)
* **Templating:** Server-side executed Go `html/template` blocks inside `/cmd/dcrdata/views`.
* **CSS Compilation:** SCSS `sass-loader` relying explicitly on overridden Bootstrap 5 utilities.

## Quality Assurance Boundaries
* **Go CI Limits:** `golangci-lint` utilizing deep `.golangci.yml` rulesets (e.g. `unparam`, `nilerr`, `bidichk`).
* **JS Formatting:** Eslint standardized structures mapping to simple Vitest DOM suites.
* **CSS Validation:** Stylelint strictly tracking standard-scss.
