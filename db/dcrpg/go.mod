module github.com/monetarium/monetarium-explorer/db/dcrpg

go 1.23

replace github.com/monetarium/monetarium-explorer => ../../

require (
	github.com/davecgh/go-spew v1.1.1
	github.com/decred/slog v1.2.0
	github.com/dustin/go-humanize v1.0.1
	github.com/jessevdk/go-flags v1.5.0
	github.com/jrick/logrotate v1.0.0
	github.com/lib/pq v1.10.9
	github.com/monetarium/monetarium-explorer v0.0.0
	github.com/monetarium/monetarium-node/blockchain/stake v1.0.14
	github.com/monetarium/monetarium-node/blockchain/standalone v1.0.14
	github.com/monetarium/monetarium-node/chaincfg v1.0.14
	github.com/monetarium/monetarium-node/chaincfg/chainhash v1.0.14
	github.com/monetarium/monetarium-node/dcrec/secp256k1 v1.0.14
	github.com/monetarium/monetarium-node/dcrutil v1.0.14
	github.com/monetarium/monetarium-node/rpc/jsonrpc/types v1.0.14
	github.com/monetarium/monetarium-node/rpcclient v1.0.14
	github.com/monetarium/monetarium-node/txscript v1.0.14
	github.com/monetarium/monetarium-node/wire v1.0.14
)

require (
	github.com/AndreasBriese/bbloom v0.0.0-20190825152654-46b345b51c96 // indirect
	github.com/agl/ed25519 v0.0.0-20170116200512-5312a6153412 // indirect
	github.com/cespare/xxhash v1.1.0 // indirect
	github.com/dchest/siphash v1.2.3 // indirect
	github.com/decred/base58 v1.0.6 // indirect
	github.com/decred/dcrd/crypto/blake256 v1.1.0 // indirect
	github.com/decred/go-socks v1.1.0 // indirect
	github.com/dgraph-io/badger v1.6.2 // indirect
	github.com/dgraph-io/ristretto v0.0.2 // indirect
	github.com/golang/protobuf v1.4.3 // indirect
	github.com/golang/snappy v0.0.4 // indirect
	github.com/gorilla/websocket v1.5.1 // indirect
	github.com/klauspost/cpuid/v2 v2.0.9 // indirect
	github.com/monetarium/monetarium-node/cointype v1.0.14 // indirect
	github.com/monetarium/monetarium-node/crypto/blake256 v1.0.14 // indirect
	github.com/monetarium/monetarium-node/crypto/rand v1.0.14 // indirect
	github.com/monetarium/monetarium-node/crypto/ripemd160 v1.0.14 // indirect
	github.com/monetarium/monetarium-node/database v1.0.14 // indirect
	github.com/monetarium/monetarium-node/dcrec v1.0.14 // indirect
	github.com/monetarium/monetarium-node/dcrec/edwards v1.0.14 // indirect
	github.com/monetarium/monetarium-node/dcrjson v1.0.14 // indirect
	github.com/monetarium/monetarium-node/gcs v1.0.14 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/syndtr/goleveldb v1.0.1-0.20210819022825-2ae1ddf74ef7 // indirect
	golang.org/x/crypto v0.33.0 // indirect
	golang.org/x/net v0.25.0 // indirect
	golang.org/x/sys v0.30.0 // indirect
	google.golang.org/protobuf v1.25.0 // indirect
	gopkg.in/yaml.v3 v3.0.0-20210107192922-496545a6307b // indirect
	lukechampine.com/blake3 v1.3.0 // indirect
)
