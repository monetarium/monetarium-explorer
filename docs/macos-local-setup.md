# Running dcrdata locally on macOS

## Prerequisites

- Go 1.20+
- Node.js 16+
- PostgreSQL 11+

Install Node.js if needed:

```sh
brew install node
```

Add Go binaries to your PATH (add to `~/.zshrc`):

```sh
export PATH=$PATH:~/go/bin
source ~/.zshrc
```

---

## Step 1 — Install and configure dcrd

dcrdata requires a running `dcrd` node. Clone and build it:

```sh
cd ~
git clone https://github.com/decred/dcrd
cd dcrd
go install .
```

Copy the sample config:

```sh
mkdir -p ~/Library/Application\ Support/Dcrd
cp ~/dcrd/sampleconfig/sample-dcrd.conf ~/Library/Application\ Support/Dcrd/dcrd.conf
```

Open and edit the config:

```sh
nano ~/Library/Application\ Support/Dcrd/dcrd.conf
```

Set your RPC credentials and enable testnet + txindex:

```ini
rpcuser=<your-username>
rpcpass=<your-password>
testnet=1
txindex=1
```

Start dcrd (keep this terminal open):

```sh
dcrd
```

On first run, dcrd generates `~/Library/Application Support/Dcrd/rpc.cert`. Wait for it to start syncing blocks before proceeding.

---

## Step 2 — Configure PostgreSQL

It is crucial to tune PostgreSQL for your hardware and the dcrdata workload. Review `db/dcrpg/postgresql-tuning.conf` in the repo for guidance. A helpful tool for generating settings based on your system specs is [PGTune](https://pgtune.leopard.in.ua/) — when using it, subtract 1.5-2GB from your total RAM to leave enough for dcrdata itself.

Do NOT copy the tuning file directly over your `postgresql.conf`. Instead, edit your existing `postgresql.conf` carefully, merging the relevant settings one by one to avoid duplicates (postgres won't warn you about duplicate settings).

To find your `postgresql.conf` on macOS:

```sh
psql postgres -c "SHOW config_file;"
```

Once tuned, create the user and database:

```sh
psql postgres -c "CREATE USER dcrdata WITH PASSWORD 'dcrdata';"
psql postgres -c "CREATE DATABASE dcrdata_testnet3 OWNER dcrdata;"
```

---

## Step 3 — Build the frontend

```sh
cd cmd/dcrdata
npm clean-install
npm run build
```

---

## Step 4 — Build the Go binary

```sh
# from cmd/dcrdata
go build -v
```

---

## Step 5 — Configure dcrdata

```sh
mkdir -p ~/Library/Application\ Support/Dcrdata
cp sample-dcrdata.conf ~/Library/Application\ Support/Dcrdata/dcrdata.conf
```

Open and edit:

```sh
nano ~/Library/Application\ Support/Dcrdata/dcrdata.conf
```

Set the following (uncomment by removing the leading `;`):

```ini
testnet=1

dcrduser=<your-username>
dcrdpass=<your-password>
dcrdcert=/Users/<you>/Library/Application Support/Dcrd/rpc.cert

pgdbname=dcrdata_testnet3
pguser=dcrdata
pgpass=dcrdata
pghost=127.0.0.1:5432
```

Use the same `rpcuser`/`rpcpass` values you set in `dcrd.conf`.

---

## Step 6 — Run dcrdata

Make sure dcrd is running and has synced enough blocks (100+), then from `cmd/dcrdata`:

```sh
./dcrdata
```

The first run performs a full blockchain sync. Do not interrupt it and do not open the browser until it completes. The initial sync goes through these steps:

1. Initial block data import
2. Indexing
3. Spending transaction relationship updates
4. Final DB analysis and indexing
5. Catch-up to network in normal sync mode
6. Populate charts historical data
7. Update Pi repo and parse proposal records (git will be running)
8. Final catch-up and UTXO cache pre-warming
9. Update project fund data and then idle

Once synced, the explorer is available at:

```
http://127.0.0.1:7777/
```

---

## Notes

- An SSD is required — PostgreSQL during initial sync is extremely disk-intensive. NVMe is preferred over SATA.
- dcrd must be running at all times while dcrdata is running.
- On subsequent starts, only new blocks are processed — much faster than the initial sync.
- Testnet sync is significantly faster than mainnet.
- The `public/` and `views/` folders must be in the same directory as the `dcrdata` binary — always run it from `cmd/dcrdata`.
