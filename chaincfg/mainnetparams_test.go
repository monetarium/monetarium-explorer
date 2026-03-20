// Copyright (c) 2014-2016 The btcsuite developers
// Copyright (c) 2015-2019 The Decred developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package chaincfg

import (
	"bytes"
	"encoding/hex"
	"testing"

	"github.com/davecgh/go-spew/spew"
)

// TestGenesisBlock tests the genesis block of the main network for validity by
// checking the encoded bytes and hashes.
func TestGenesisBlock(t *testing.T) {
	// V13 wire format with CoinType in TxOut and SKAValueInLen in witness
	// Genesis block bytes with new timestamp (Feb 24, 2026 = 0x699cea00)
	// and CPU-friendly difficulty (0x1d00ffff) for bootstrap
	genesisBlockBytes, _ := hex.DecodeString("010000000000000000000000000000000000000000000000000000000000000000000000e6ae5c49181b32f7e788dcdf2bd7ebc85bc8c11e330d1b8d541945277a4010a2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffff001d00c2eb0b00000000000000000000000000ea9c69000000000000000000000000000000000000000000000000000000000000000000000000000000000101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff00ffffffff01000000000000000000000020801679e98561ada96caec2949a5d41c4cab3851eb740d951c10ecbcf265c1fd9000000000000000001000000000000000000000000000000000002000000")

	// Encode the genesis block to raw bytes.
	params := MainNetParams()
	var buf bytes.Buffer
	err := params.GenesisBlock.Serialize(&buf)
	if err != nil {
		t.Fatalf("TestGenesisBlock: %v", err)
	}

	// Ensure the encoded block matches the expected bytes.
	if !bytes.Equal(buf.Bytes(), genesisBlockBytes) {
		t.Fatalf("TestGenesisBlock: Genesis block does not appear valid - "+
			"got %v, want %v", spew.Sdump(buf.Bytes()),
			spew.Sdump(genesisBlockBytes))
	}

	// Check hash of the block against expected hash.
	hash := params.GenesisBlock.BlockHash()
	if !params.GenesisHash.IsEqual(&hash) {
		t.Fatalf("TestGenesisBlock: Genesis block hash does not "+
			"appear valid - got %v, want %v", spew.Sdump(hash),
			spew.Sdump(params.GenesisHash))
	}
}
