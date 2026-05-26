module github.com/monetarium/monetarium-explorer/cmd/dcrdata

go 1.23

replace (
	github.com/monetarium/monetarium-explorer => ../../
	github.com/monetarium/monetarium-explorer/db/dcrpg => ../../db/dcrpg/
	github.com/monetarium/monetarium-explorer/exchanges => ../../exchanges/
	github.com/monetarium/monetarium-explorer/gov => ../../gov/
)

require (
	github.com/caarlos0/env/v6 v6.10.1
	github.com/decred/politeia v1.5.0
	github.com/decred/slog v1.2.0
	github.com/didip/tollbooth/v6 v6.1.3-0.20220606152938-a7634c70944a
	github.com/dustin/go-humanize v1.0.1
	github.com/go-chi/chi/v5 v5.0.8
	github.com/go-chi/docgen v1.2.0
	github.com/google/gops v0.3.27
	github.com/googollee/go-socket.io v1.4.4
	github.com/jessevdk/go-flags v1.5.0
	github.com/jrick/logrotate v1.0.0
	github.com/monetarium/monetarium-explorer v0.0.0
	github.com/monetarium/monetarium-explorer/db/dcrpg v0.0.0
	github.com/monetarium/monetarium-explorer/gov v0.0.0
	github.com/monetarium/monetarium-node/blockchain/stake v1.1.0
	github.com/monetarium/monetarium-node/blockchain/standalone v1.1.0
	github.com/monetarium/monetarium-node/chaincfg v1.1.0
	github.com/monetarium/monetarium-node/chaincfg/chainhash v1.1.0
	github.com/monetarium/monetarium-node/cointype v1.0.14
	github.com/monetarium/monetarium-node/dcrutil v1.1.0
	github.com/monetarium/monetarium-node/rpc/jsonrpc/types v1.1.0
	github.com/monetarium/monetarium-node/rpcclient v1.1.0
	github.com/monetarium/monetarium-node/txscript v1.1.0
	github.com/monetarium/monetarium-node/wire v1.1.0
	github.com/rs/cors v1.8.2
	golang.org/x/net v0.28.0
	golang.org/x/text v0.22.0
	pgregory.net/rapid v1.2.0
)

require (
	github.com/golang/glog v1.2.0 // indirect
	google.golang.org/appengine v1.6.8 // indirect
)

require (
	decred.org/dcrwallet v1.7.0 // indirect
	github.com/AndreasBriese/bbloom v0.0.0-20190825152654-46b345b51c96 // indirect
	github.com/DataDog/zstd v1.5.2 // indirect
	github.com/agl/ed25519 v0.0.0-20170116200512-5312a6153412 // indirect
	github.com/asdine/storm/v3 v3.2.1 // indirect
	github.com/cespare/xxhash v1.1.0 // indirect
	github.com/coder/websocket v1.8.14
	github.com/dchest/siphash v1.2.3 // indirect
	github.com/decred/base58 v1.0.6 // indirect
	github.com/decred/dcrd/blockchain/stake/v3 v3.0.0 // indirect
	github.com/decred/dcrd/blockchain/standalone/v2 v2.2.1 // indirect
	github.com/decred/dcrd/certgen v1.2.0 // indirect
	github.com/decred/dcrd/chaincfg/chainhash v1.0.4 // indirect
	github.com/decred/dcrd/chaincfg/v3 v3.2.1 // indirect
	github.com/decred/dcrd/crypto/blake256 v1.1.0 // indirect
	github.com/decred/dcrd/crypto/rand v1.0.1 // indirect
	github.com/decred/dcrd/crypto/ripemd160 v1.0.2 // indirect
	github.com/decred/dcrd/database/v2 v2.0.2 // indirect
	github.com/decred/dcrd/dcrec v1.0.1 // indirect
	github.com/decred/dcrd/dcrec/edwards/v2 v2.0.3 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v3 v3.0.0 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.3.0 // indirect
	github.com/decred/dcrd/dcrutil/v3 v3.0.0 // indirect
	github.com/decred/dcrd/gcs/v2 v2.1.0 // indirect
	github.com/decred/dcrd/hdkeychain/v3 v3.1.2 // indirect
	github.com/decred/dcrd/txscript/v3 v3.0.0 // indirect
	github.com/decred/dcrd/wire v1.7.0 // indirect
	github.com/decred/dcrtime v0.0.0-20191018193024-8d8b4ef0458e // indirect
	github.com/decred/go-socks v1.1.0 // indirect
	github.com/dgraph-io/badger v1.6.2 // indirect
	github.com/dgraph-io/ristretto v0.0.2 // indirect
	github.com/go-pkgz/expirable-cache v0.1.0 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/golang/snappy v0.0.5-0.20220116011046-fa5810519dcb // indirect
	github.com/google/trillian v1.4.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gorilla/schema v1.1.0 // indirect
	github.com/gorilla/websocket v1.5.1 // indirect
	github.com/h2non/go-is-svg v0.0.0-20160927212452-35e8c4b0612c // indirect
	github.com/klauspost/cpuid/v2 v2.2.8 // indirect
	github.com/lib/pq v1.10.9 // indirect
	github.com/marcopeereboom/sbox v1.1.0 // indirect
	github.com/monetarium/monetarium-node/crypto/blake256 v1.0.14 // indirect
	github.com/monetarium/monetarium-node/crypto/rand v1.0.14 // indirect
	github.com/monetarium/monetarium-node/crypto/ripemd160 v1.0.14 // indirect
	github.com/monetarium/monetarium-node/database v1.1.0 // indirect
	github.com/monetarium/monetarium-node/dcrec v1.0.14 // indirect
	github.com/monetarium/monetarium-node/dcrec/edwards v1.0.14 // indirect
	github.com/monetarium/monetarium-node/dcrec/secp256k1 v1.0.14 // indirect
	github.com/monetarium/monetarium-node/dcrjson v1.0.14 // indirect
	github.com/monetarium/monetarium-node/gcs v1.0.14 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/syndtr/goleveldb v1.0.1-0.20210819022825-2ae1ddf74ef7 // indirect
	go.etcd.io/bbolt v1.3.11 // indirect
	golang.org/x/crypto v0.33.0 // indirect
	golang.org/x/sys v0.30.0 // indirect
	golang.org/x/time v0.5.0 // indirect
	google.golang.org/protobuf v1.34.2 // indirect
	lukechampine.com/blake3 v1.3.0 // indirect
)
