# Technology Stack

Monetarium Explorer bridges rigorous Go multi-module architectures with frontend Javascript SPA concepts over a dynamic Postgres database layer.

## Foundation & Backend
* **Language:** Go 1.23
* **Routing:** `go-chi/chi/v5`
* **Datastore:** 
  * PostgreSQL `lib/pq` (General Chain Storage)
  * Badger (Embedded KV for fast stake analysis)
* **High-Precision Logic:** Specialized big-number package routing 15+18 digit arithmetic.
* **RPC Layer:** Protobuf bindings to `monetarium/monetarium-node/rpcclient`
* **WebSockets:** `gorilla/websocket` with nested `googollee/go-socket.io` for generic Insight bridges.

## Frontend
* **Build Engine:** Webpack 5 (Configs handled by `.cjs` split environments)
* **DOM Controllers:** Stimulus 3 (`@hotwired/stimulus`) handling strict one-controller-per-page logic.
* **SPA Orchestrator:** Turbolinks 5.2.0 (Note: specifically skipped Hotwire Turbo upgrades in favor of vendored turbolinks)
* **Templating:** Server-side executed Go `html/template` blocks inside `/cmd/dcrdata/views`.
* **CSS Compilation:** SCSS `sass-loader` relying explicitly on overridden Bootstrap 5 utilities.

## Quality Assurance Boundaries
* **Go CI Limits:** `golangci-lint` utilizing deep `.golangci.yml` rulesets (e.g. `unparam`, `nilerr`, `bidichk`).
* **JS Formatting:** Eslint standardized structures mapping to simple Vitest DOM suites.
* **CSS Validation:** Stylelint strictly tracking standard-scss.
