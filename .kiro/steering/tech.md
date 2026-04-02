# Tech Stack

## Backend

- **Language**: Go 1.21+ (multi-module workspace; `cmd/dcrdata` requires Go 1.22)
- **Big-number arithmetic**: A specialized module is required for SKA token calculations (15 integer + 18 decimal digits — exceeds float64 precision). Do not use standard Go numeric types for SKA amounts.
- **HTTP router**: `go-chi/chi/v5`
- **Database**: PostgreSQL via `lib/pq`; Badger (embedded KV) for stake data
- **Logging**: `decred/slog` with `jrick/logrotate`
- **RPC**: `decred/dcrd/rpcclient/v8` for dcrd communication; gRPC for exchange rate server
- **WebSocket**: `gorilla/websocket`, `googollee/go-socket.io` (Insight API)
- **Rate limiting**: `didip/tollbooth/v6`
- **CORS**: `rs/cors`
- **Config**: `jessevdk/go-flags` + `caarlos0/env/v6`

## Frontend

- **Bundler**: Webpack 5 (configs: `webpack.common.js`, `webpack.dev.js`, `webpack.prod.js`, `webpack.analyze.js`)
- **JS framework**: Stimulus 3 — one controller per page feature in `public/js/controllers/`
- **SPA navigation**: Turbolinks 5.2.0 (vendored at `public/js/vendor/turbolinks.min.js`) — not Hotwire Turbo
- **CSS**: SCSS compiled via `sass-loader`; Bootstrap 5 as base; custom overrides in `public/scss/`
- **Templates**: Go `html/template` (`.tmpl` files in `cmd/dcrdata/views/`)
- **Key JS deps**: `lodash-es`, `dompurify`, `qrcode`, `mousetrap`, `url-parse`, `regenerator-runtime`

## Linting

- **Go**: `golangci-lint` v2 with config at `.golangci.yml`
  - Enabled linters: `asciicheck`, `bidichk`, `durationcheck`, `errchkjson`, `govet`, `grouper`, `ineffassign`, `makezero`, `misspell`, `nilerr`, `nosprintfhostport`, `reassign`, `rowserrcheck`, `tparallel`, `unconvert`, `unparam`
  - Enabled formatters: `gofmt`, `goimports`
- **JS**: ESLint (`eslint-config-standard`) — `npm run lint`
- **CSS**: Stylelint (`stylelint-config-standard-scss`)

## Common Commands

### Frontend

```sh
cd cmd/dcrdata
npm clean-install        # install node deps
npm run build            # production webpack bundle → public/dist/
npm run watch            # dev watch mode
npm run lint             # ESLint on public/js
npm run analyze          # webpack bundle analysis
```

### Backend

```sh
cd cmd/dcrdata
go build -v              # build the dcrdata binary
```

With version flags:

```sh
go build -v -ldflags "-X main.appPreRelease=beta -X main.appBuild=$(git rev-parse --short HEAD)"
```

Or use the helper script from the repo root:

```sh
./dev/build.sh
```

### Testing

```sh
# Run all module tests (from repo root)
./run_tests.sh

# With optional build tags
TESTTAGS="pgonline" ./run_tests.sh
TESTTAGS="pgonline fullpgdb" ./run_tests.sh

# Single module
cd <module-dir> && go test ./...
```

### Linting

```sh
golangci-lint run -c .golangci.yml   # from any module directory
```
