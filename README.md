# Monetarium Explorer

[![Build Status](https://github.com/monetarium/monetarium-explorer/workflows/Build%20and%20Test/badge.svg)](https://github.com/monetarium/monetarium-explorer/actions)
[![ISC License](https://img.shields.io/badge/license-ISC-blue.svg)](http://copyfree.org)

## Overview

Monetarium Explorer is a block explorer for the [Monetarium](https://monetarium.io) network, forked from [decred/dcrdata](https://github.com/decred/dcrdata). It supports the dual-coin model (VAR + SKA types) introduced by monetarium-node. The backend is written in Go with a PostgreSQL database. The frontend uses Webpack/SCSS.

- [Overview](#overview)
- [Requirements](#requirements)
- [Building](#building)
- [Contributing](#contributing)
- [Local Testing on Testnet](#local-testing-on-testnet)
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
├── exchanges                  MODULE and package for gathering data from public exchange APIs.
│   ├── rateserver             Exchange rate gRPC server.
│   └── ratesproto             Package dcrrates implementing the gRPC protobuf service.
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
- Running `monetarium-node` synchronized to the current best block
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

## Local Testing on Testnet

### Prerequisites

- Built `monetarium-node` binary
- Built `monetarium-explorer` binary (see [Building](#building))
- PostgreSQL running locally

---

### Step 1: Start monetarium-node on testnet3

Create `~/.monetarium-node/monetarium-node.conf`: (macOS: ~/Library/Application Support/Monetarium/)

```ini
testnet=1
rpcuser=monuser
rpcpass=monpass
rpclisten=127.0.0.1:19509
txindex=1
```

Start and wait for full sync:

```sh
./monetarium-node --testnet
```

Wait until the log shows `New best block` at the current testnet height before proceeding.

---

### Step 2: Create the PostgreSQL database

```sh
createuser -P monetarium_testnet    # enter a password, e.g. "testpass"
createdb -O monetarium_testnet monetarium_testnet
```

---

### Step 3: Configure monetarium-explorer

```sh
mkdir -p ~/.monetarium-explorer # # macOS: ~/Library/Application\ Support/Monetarium-explorer
cp cmd/dcrdata/sample-dcrdata.conf ~/.monetarium-explorer/monetarium-explorer.conf
```

Edit `~/.monetarium-explorer/monetarium-explorer.conf`:

```ini
testnet=1

; monetarium-node RPC credentials (must match Step 1)
dcrduser=monuser
dcrdpass=monpass
dcrdserv=127.0.0.1:19509
dcrdcert=~/.monetarium-node/rpc.cert

; PostgreSQL
pg=1
pgdbname=monetarium_testnet
pguser=monetarium_testnet
pgpass=testpass
pghost=127.0.0.1:5432

; Web interface
apilisten=127.0.0.1:7777
apiproto=http

debuglevel=debug
```

---

### Step 4: Run monetarium-explorer

```sh
cd cmd/dcrdata
./monetarium-explorer
```

On first run the explorer will create the DB schema and begin syncing all blocks. **Do not interrupt the initial sync.**

---

### Step 5: Verify

Once sync reaches the tip, open:

http://127.0.0.1:7777

Check the API:

```sh
curl http://127.0.0.1:7777/api/block/best
```

---

### Ports reference

| Service                        | Port                |
| ------------------------------ | ------------------- |
| monetarium-node P2P (testnet3) | 19508               |
| monetarium-node RPC (testnet3) | 19509               |
| monetarium-explorer web/API    | 7777 (configurable) |

---

### Troubleshooting

| Error                                                | Fix                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `expected network testnet3, got Unknown CurrencyNet` | Rebuild monetarium-node from source; stale binary has old wire constants      |
| `Connection to dcrd failed`                          | Verify `dcrdserv`, `dcrduser`, `dcrdpass`, and that the node is fully started |
| `pq: relation does not exist`                        | Ensure `pg=1` is set and the DB user has CREATE privileges                    |
| `bad project fund address`                           | Safe to ignore; Monetarium has no treasury                                    |

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

**Upstream Reference**
Forked from [decred/dcrdata](https://github.com/decred/dcrdata).
Base commit: `9c02e7116ede87b57ee6189c5dc3c22d48937a3a`
