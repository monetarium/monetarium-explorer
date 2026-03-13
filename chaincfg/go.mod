module github.com/decred/dcrdata/chaincfg/v6

go 1.21

replace github.com/decred/dcrdata/v8 => ../

require (
	github.com/davecgh/go-spew v1.1.1
	github.com/monetarium/monetarium-node/chaincfg/chainhash v1.0.5
	github.com/monetarium/monetarium-node/wire v1.0.14
)

require (
	github.com/monetarium/monetarium-node/crypto/blake256 v1.1.0 // indirect
	github.com/klauspost/cpuid/v2 v2.0.9 // indirect
	lukechampine.com/blake3 v1.3.0 // indirect
)
