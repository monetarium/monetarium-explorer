# Monetarium Explorer

[![Build Status](https://github.com/monetarium/monetarium-explorer/workflows/Build%20and%20Test/badge.svg)](https://github.com/monetarium/monetarium-explorer/actions)
[![ISC License](https://img.shields.io/badge/license-ISC-blue.svg)](http://copyfree.org)

## Overview

Monetarium Explorer is a block explorer for the [Monetarium](https://monetarium.io) network. The codebase originated from [decred/dcrdata](https://github.com/decred/dcrdata) — history was squashed into a single initial commit and there is no git upstream or ongoing sync, so it is maintained as a standalone codebase rather than a fork. It supports the multi-coin model introduced by monetarium-node: VAR plus up to 255 SKA-type coins (`SKA1`, `SKA2`, …). A single transaction is always single-coin — every input, output, and the fee belong to the same coin type — so explorer data structures carry per-coin-type maps and per-coin views rather than a single value. The backend is written in Go with a PostgreSQL database. The frontend uses Webpack/SCSS.

- [Overview](#overview)
- [Requirements](#requirements)
- [Building](#building)
- [Development Workflow](#development-workflow)
- [Contributing](#contributing)
- [Local Testing (Testnet and Mainnet)](#local-testing-testnet-and-mainnet)
- [Getting Started (Production)](#getting-started-production)
- [APIs](#apis)
- [License](#license)

## Repository Overview

```none
../monetarium-explorer         The main Go MODULE. See cmd/dcrdata for the explorer executable.
├── api/types                  The exported structures used by the dcrdata and Insight APIs.
├── blockdata                  Package blockdata is the primary data collection and
|                                storage hub, and chain monitor.
├── cmd
│   └── dcrdata                MODULE for the monetarium-explorer executable.
│       ├── api                dcrdata's own HTTP API
│       │   └── insight        The Insight API
│       ├── explorer           Powers the block explorer pages.
│       ├── middleware         HTTP router middleware used by the explorer
│       ├── notification       Manages dcrd notifications synchronous data collection.
│       ├── public             Public resources for block explorer (css, js, etc.)
│       └── views              HTML templates for block explorer
├── db
│   ├── cache                  Package cache provides a caching layer used by dcrpg.
│   ├── dbtypes                Package dbtypes with common data types.
│   └── dcrpg                  MODULE and package dcrpg providing PostgreSQL backend.
├── dev                        Shell scripts for maintenance and deployment.
├── docs                       Extra documentation.
├── explorer/types             Types used primarily by the explorer pages.
├── gov                        MODULE for on- and off-chain governance packages.
│   ├── agendas                Package agendas defines a consensus deployment/agenda DB.
│   └── politeia               Package politeia defines a Politeia proposal DB.
├── mempool                    Package mempool for monitoring mempool transactions.
├── netparams                  TCP port numbers for mainnet, testnet, simnet.
├── pubsub                     Websocket-based pub-sub server for blockchain data.
│   ├── democlient             Example client for the pubsub server.
│   ├── psclient               Basic client package for the pubsub server.
│   └── types                  Types used by the pubsub client and server.
├── rpcutils                   Helper types and functions for chain server RPC.
├── semver                     Semantic version types.
├── stakedb                    Package stakedb for tracking tickets.
├── testutil
│   ├── apiload                HTTP API load testing application.
│   └── dbload                 DB load testing application.
└── txhelpers                  Functions and types for processing blocks, transactions, etc.
```

## Requirements

- [Go](https://golang.org) 1.21+
- [Node.js](https://nodejs.org/en/download/) 16.x or later (build only, not runtime)
- Running `monetarium-node` synchronized to the current best block (this release is built against `monetarium-node` v1.3.6)
- PostgreSQL 13+

## Building

### 1. Bundle static web assets

```sh
cd cmd/dcrdata
npm clean-install
npm run build
```

### 2. Build the executable

```sh
cd cmd/dcrdata
go build -o monetarium-explorer .
```

The `public` and `views` folders must remain in the same directory as the `monetarium-explorer` binary.

### 3. Run with Docker (Alternative)

Alternatively, you can run the explorer using Docker.

**Build the image:**

```sh
docker build -t monetarium-explorer .
```

**Run the container:**
Mount your `monetarium-node` configuration directory (containing `rpc.cert`) to the container to allow the explorer to authenticate with the node:

```sh
docker run -p 7777:7777 -v ~/.monetarium:/home/explorer/.monetarium monetarium-explorer
```

---

## Development Workflow

### Live reloading of CSS, JS, and HTML templates

During development you can get instant feedback on frontend changes without restarting the Go server.

**1. Start the webpack watcher** (from `cmd/dcrdata`):

```sh
npm run watch
```

This watches all JS and SCSS files imported from `public/index.js` and rebuilds on every save. The output hashes in `public/dist/manifest.json` are updated automatically, and the server reads that file on every request — so a hard reload in the browser is all you need to pick up CSS or JS changes.

**2. Start the explorer with HTML template reloading** (from `cmd/dcrdata`):

```sh
./monetarium-explorer --reload-html
```

With `--reload-html` enabled, Go HTML templates in the `views/` folder are re-parsed on every request, so you can edit `.tmpl` files and see changes with a hard reload in the browser — no server restart required.

**Summary of what requires a restart vs. what doesn't:**

| Change                           | Requires restart?         |
| -------------------------------- | ------------------------- |
| SCSS / CSS (`npm run watch`)     | No — hard reload          |
| JavaScript (`npm run watch`)     | No — hard reload          |
| HTML templates (`--reload-html`) | No — hard reload          |
| Go source code                   | Yes — rebuild and restart |

---

## Contributing

### Install git hooks

After cloning, run this once to install the pre-commit hooks:

```sh
./dev/install-hooks.sh
```

The pre-commit hook runs automatically on every `git commit` and checks only the files you've staged:

| Staged files      | Checks run                                                 |
| ----------------- | ---------------------------------------------------------- |
| `*.go`            | `gofmt` format check + `go test ./...` per affected module |
| `*.js` / `*.scss` | Prettier format check, ESLint, Stylelint, Vitest           |

If any check fails, the commit is blocked with instructions on how to fix it.

### Running checks manually

**Go** (from any module directory):

```sh
gofmt -l .                        # list files needing formatting
gofmt -w .                        # fix formatting
go test ./...                     # run tests
golangci-lint run -c .golangci.yml
```

**JS / SCSS** (from `cmd/dcrdata`):

```sh
npm run format:check   # prettier check
npm run format         # prettier fix
npm run lint           # ESLint
npm run lint:fix       # ESLint fix
npm run lint:css       # Stylelint
npm run lint:css:fix   # Stylelint fix
npm test               # Vitest unit tests
```

---

## Local Testing (Testnet and Mainnet)

You can run the explorer against **testnet**, **mainnet**, or **both at once** on the same machine. Both `monetarium-node` and `monetarium-explorer` namespace their data and logs by network (`…/data/testnet3` vs `…/data/mainnet`) and choose per-network default ports, so running two networks side by side only requires **three things to differ**: the **config file** (which carries the network selection), the **PostgreSQL database**, and the **web/API port**.

Everything below is parameterized by network — read the column for the network you want:

| Parameter                          | testnet                   | mainnet                       |
| ---------------------------------- | ------------------------- | ----------------------------- |
| network selector                   | `testnet=1` / `--testnet` | _(none — mainnet is default)_ |
| node RPC port (default)            | 19509                     | 9509                          |
| node P2P port (default)            | 19508                     | 9508                          |
| explorer web/API port (default)    | 17778                     | 7777                          |
| `{netname}` (data dir / DB suffix) | `testnet3`                | `mainnet`                     |

The same `monetarium-explorer` binary serves every network — build it once. There is no `--mainnet` flag: mainnet is selected by the **absence** of `testnet=1`, and a `testnet=1` set in a config file **cannot** be overridden from the command line. So each instance takes its network from the config file it loads (or the `--testnet` flag).

> **macOS paths.** The config dirs are `~/Library/Application Support/Monetarium/` and `~/Library/Application Support/Monetarium-explorer/` (shown below in their POSIX `~/.monetarium…` form). The space in the macOS path means you must quote it or use `$HOME` when passing it to `--configfile`, e.g. `--configfile="$HOME/Library/Application Support/Monetarium-explorer/monetarium-explorer-mainnet.conf"`.

### Prerequisites

- Built `monetarium-node` binary
- Built `monetarium-explorer` binary (see [Building](#building))
- PostgreSQL running locally

---

### Step 1: Start monetarium-node

Config dir: `~/.monetarium/`. The RPC/P2P ports, data directory, and logs are all chosen automatically per network, so the config only needs credentials and `txindex`.

**Testnet** — `monetarium.conf`:

```ini
testnet=1
rpcuser=monuser
rpcpass=monpass
txindex=1
```

```sh
./monetarium-node --testnet
```

**Mainnet** — a separate `monetarium-mainnet.conf` (so the `testnet=1` default file is not reused):

```ini
rpcuser=monuser
rpcpass=monpass
txindex=1
```

```sh
./monetarium-node --configfile="$HOME/.monetarium/monetarium-mainnet.conf"
```

Both networks share the same `rpc.cert`. Wait until the node is syncing (`New valid peer …`, then `New best block`) before starting the explorer. A fresh network with no DNS seeders sits at height 0 with 0 peers — add `addpeer=<ip>:9508` (mainnet) / `addpeer=<ip>:19508` (testnet) lines to bootstrap it.

---

### Step 2: Create the PostgreSQL database

One database per network. Naming them with the `{netname}` suffix lets a single explorer config line cover both:

```sh
createuser -P monetarium_explorer    # set a password once; reused for both DBs
createdb -O monetarium_explorer monetarium_explorer_testnet3
createdb -O monetarium_explorer monetarium_explorer_mainnet
```

---

### Step 3: Configure monetarium-explorer

Config dir: `~/.monetarium-explorer/`. One config file per network, differing only by the `testnet=1` line:

```sh
cp cmd/dcrdata/sample-dcrdata.conf ~/.monetarium-explorer/monetarium-explorer.conf
```

**Testnet** — `monetarium-explorer.conf`:

```ini
testnet=1

; monetarium-node RPC credentials (must match Step 1)
dcrduser=monuser
dcrdpass=monpass
dcrdserv=127.0.0.1:19509           ; node RPC port — testnet 19509, mainnet 9509
dcrdcert=~/.monetarium/rpc.cert

; PostgreSQL — {netname} expands to testnet3 / mainnet
pgdbname=monetarium_explorer_{netname}
pguser=monetarium_explorer
pgpass=yourpass
pghost=127.0.0.1:5432

; Web interface — omit apilisten to use the per-network default (17778 / 7777)
apiproto=http
debuglevel=debug
```

**Mainnet** — `monetarium-explorer-mainnet.conf`: the same, but **without** the `testnet=1` line and with `dcrdserv=127.0.0.1:9509` (the mainnet RPC port).

A few notes on these settings:

- **`pgdbname=monetarium_explorer_{netname}`** — `{netname}` is replaced with the active network name, so the same line yields `…_testnet3` or `…_mainnet`.
- **Omit `apilisten`** — each network then binds its own default web port (17778 / 7777), which is collision-proof when both run at once. Set it explicitly only to change the port or bind beyond loopback (e.g. `apilisten=0.0.0.0:7777`).
- **`dcrdserv` needs the RPC port explicitly**, and it differs per network (`127.0.0.1:19509` testnet, `127.0.0.1:9509` mainnet). Omitting the port falls back to the node's P2P port (19508 / 9508), not its RPC port, so the explorer fails to connect.
- Setting any PostgreSQL option enables PG mode; there is no separate `pg=1` flag.

---

### Step 4: Run monetarium-explorer

Build once, then run one instance per network (each in its own terminal):

```sh
cd cmd/dcrdata
go build -o monetarium-explorer .

# Testnet (reads the default monetarium-explorer.conf, which sets testnet=1)
./monetarium-explorer

# Mainnet (select the mainnet config file)
./monetarium-explorer --configfile="$HOME/.monetarium-explorer/monetarium-explorer-mainnet.conf"
```

On first run against a new database the explorer creates the schema and begins syncing all blocks. **Do not interrupt the initial sync.**

---

### Step 5: Verify

| Network | Web UI                 | API                                          |
| ------- | ---------------------- | -------------------------------------------- |
| testnet | http://127.0.0.1:17778 | `curl http://127.0.0.1:17778/api/block/best` |
| mainnet | http://127.0.0.1:7777  | `curl http://127.0.0.1:7777/api/block/best`  |

---

### Ports reference

| Service                     | testnet3 | mainnet |
| --------------------------- | -------- | ------- |
| monetarium-node P2P         | 19508    | 9508    |
| monetarium-node RPC         | 19509    | 9509    |
| monetarium-explorer web/API | 17778    | 7777    |

---

### Troubleshooting

| Error                                                                                 | Fix                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expected network testnet3, got Unknown CurrencyNet`                                  | Rebuild monetarium-node from source; stale binary has old wire constants                                                                                                                                               |
| `Connection to dcrd failed`                                                           | Verify `dcrdserv`, `dcrduser`, `dcrdpass`, and that the node for that network is fully started                                                                                                                         |
| `pq: relation does not exist`                                                         | Ensure the PostgreSQL options are set and the DB user has CREATE privileges                                                                                                                                            |
| `Unable to initialize vote tracker: Unexpected number of blocks ... GetStakeVersions` | The node is below ~2016 blocks (e.g. a brand-new mainnet); the vote tracker needs a taller chain and recovers once it grows. To start the explorer earlier, build from the `hotfix/disable-vote-tracker-checks` branch |
| `listen tcp ...:7777: bind: address already in use`                                   | Another instance already holds that web port — omit `apilisten` so each network uses its own default, or pick a distinct port                                                                                          |
| `bad project fund address`                                                            | Safe to ignore; Monetarium has no treasury                                                                                                                                                                             |

---

## Getting Started (Production)

### Configure PostgreSQL

Tune PostgreSQL for your hardware. Use [PGTune](https://pgtune.leopard.in.ua/) as a starting point, reserving 1.5–2 GB for the explorer process itself. On Linux, prefer a Unix domain socket (`pghost=/run/postgresql`) over TCP.

### Configuration file

sh
cp cmd/dcrdata/sample-dcrdata.conf ~/.monetarium-explorer/monetarium-explorer.conf

Edit with your `monetarium-node` RPC credentials and PostgreSQL settings. Run `./monetarium-explorer --help` for all options.

### Initial sync

On first startup the explorer imports all blockchain data and builds indexes. This can take 1.5–8 hours depending on hardware. **Do not interrupt.** An NVMe SSD is strongly recommended for the PostgreSQL host.

### Hardware requirements

| Setup                     | CPU      | RAM    | Storage         |
| ------------------------- | -------- | ------ | --------------- |
| Explorer only (remote DB) | 1 core   | 2 GB   | 8 GB HDD        |
| Explorer + PostgreSQL     | 3+ cores | 12+ GB | 120 GB NVMe SSD |

---

## APIs

The explorer exposes two APIs on the same port:

- **dcrdata API** — path prefix `/api`
- **Insight API** — path prefix `/insight/api`

See [docs/Insight_API_documentation.md](docs/Insight_API_documentation.md) for the Insight API.

Key dcrdata API endpoints:

| Resource           | Path                     |
| ------------------ | ------------------------ |
| Best block summary | `/api/block/best`        |
| Block by height    | `/api/block/{height}`    |
| Transaction        | `/api/tx/{txid}`         |
| Address            | `/api/address/{address}` |
| Coin supply        | `/api/supply`            |
| Mempool tickets    | `/api/mempool/sstx`      |
| Status             | `/api/status`            |

All endpoints accept `?indent=true` for pretty-printed JSON.

---

## License

ISC License. See [LICENSE](LICENSE) for details.

---

**Origin**
The codebase originated from [decred/dcrdata](https://github.com/decred/dcrdata) at commit `9c02e7116ede87b57ee6189c5dc3c22d48937a3a` and has since diverged. There is no git upstream and no ongoing sync.
