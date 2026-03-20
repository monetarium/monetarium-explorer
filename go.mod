module github.com/monetarium/monetarium-explorer

go 1.23

require (
	github.com/davecgh/go-spew v1.1.1
	github.com/decred/base58 v1.0.6
	github.com/decred/dcrd/chaincfg/chainhash v1.0.5
	github.com/decred/dcrd/chaincfg/v3 v3.3.0
	github.com/decred/dcrd/dcrutil/v4 v4.0.3
	github.com/decred/dcrd/rpcclient/v8 v8.1.0
	github.com/decred/slog v1.2.0
	github.com/dgraph-io/badger v1.6.2
	github.com/lib/pq v1.10.9
	github.com/monetarium/monetarium-node/blockchain/stake v1.1.0
	github.com/monetarium/monetarium-node/blockchain/standalone v1.1.0
	github.com/monetarium/monetarium-node/chaincfg v1.1.0
	github.com/monetarium/monetarium-node/chaincfg/chainhash v1.1.0
	github.com/monetarium/monetarium-node/database v1.1.0
	github.com/monetarium/monetarium-node/dcrutil v1.1.0
	github.com/monetarium/monetarium-node/rpc/jsonrpc/types v1.1.0
	github.com/monetarium/monetarium-node/rpcclient v1.1.0
	github.com/monetarium/monetarium-node/txscript v1.1.0
	github.com/monetarium/monetarium-node/wire v1.1.0
	golang.org/x/net v0.25.0
)

require (
	github.com/AndreasBriese/bbloom v0.0.0-20190825152654-46b345b51c96 // indirect
	github.com/agl/ed25519 v0.0.0-20170116200512-5312a6153412 // indirect
	github.com/cespare/xxhash v1.1.0 // indirect
	github.com/dchest/siphash v1.2.3 // indirect
	github.com/decred/dcrd/blockchain/stake/v5 v5.0.2 // indirect
	github.com/decred/dcrd/crypto/blake256 v1.1.0 // indirect
	github.com/decred/dcrd/crypto/rand v1.0.1 // indirect
	github.com/decred/dcrd/crypto/ripemd160 v1.0.2 // indirect
	github.com/decred/dcrd/database/v3 v3.0.3 // indirect
	github.com/decred/dcrd/dcrec v1.0.1 // indirect
	github.com/decred/dcrd/dcrec/edwards/v2 v2.0.4 // indirect
	github.com/decred/dcrd/dcrec/secp256k1/v4 v4.4.0 // indirect
	github.com/decred/dcrd/dcrjson/v4 v4.2.0 // indirect
	github.com/decred/dcrd/gcs/v4 v4.1.1 // indirect
	github.com/decred/dcrd/rpc/jsonrpc/types/v4 v4.4.0 // indirect
	github.com/decred/dcrd/txscript/v4 v4.1.2 // indirect
	github.com/decred/dcrd/wire v1.7.1 // indirect
	github.com/decred/go-socks v1.1.0 // indirect
	github.com/dgraph-io/ristretto v0.0.2 // indirect
	github.com/dustin/go-humanize v1.0.1-0.20210705192016-249ff6c91207 // indirect
	github.com/golang/protobuf v1.4.3 // indirect
	github.com/golang/snappy v0.0.4 // indirect
	github.com/google/go-cmp v0.5.4 // indirect
	github.com/gorilla/websocket v1.5.1 // indirect
	github.com/klauspost/cpuid/v2 v2.0.9 // indirect
	github.com/monetarium/monetarium-node/cointype v1.0.11 // indirect
	github.com/monetarium/monetarium-node/crypto/blake256 v1.1.0 // indirect
	github.com/monetarium/monetarium-node/crypto/rand v1.0.11 // indirect
	github.com/monetarium/monetarium-node/crypto/ripemd160 v1.0.11 // indirect
	github.com/monetarium/monetarium-node/dcrec v1.0.11 // indirect
	github.com/monetarium/monetarium-node/dcrec/edwards v1.0.11 // indirect
	github.com/monetarium/monetarium-node/dcrec/secp256k1 v1.0.11 // indirect
	github.com/monetarium/monetarium-node/dcrjson v1.0.11 // indirect
	github.com/monetarium/monetarium-node/gcs v1.0.11 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/stretchr/testify v1.7.0 // indirect
	github.com/syndtr/goleveldb v1.0.1-0.20210819022825-2ae1ddf74ef7 // indirect
	golang.org/x/crypto v0.33.0 // indirect
	golang.org/x/sys v0.30.0 // indirect
	google.golang.org/protobuf v1.25.0 // indirect
	gopkg.in/yaml.v2 v2.4.0 // indirect
	lukechampine.com/blake3 v1.3.0 // indirect
)

replace github.com/monetarium/monetarium-node/chaincfg => ./chaincfg
