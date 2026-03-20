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

// TestRegNetGenesisBlock tests the genesis block of the regression test network
// for validity by checking the encoded bytes and hashes.
func TestRegNetGenesisBlock(t *testing.T) {
	// V13 wire format with CoinType in TxOut and SKAValueInLen in witness
	regNetGenesisBlockBytes, _ := hex.DecodeString("01000000000000000000000000000000000000000000000000000000000000000000000068559653086d3d1e4ebb9d09f62ead0e2aa3ee004cb9a07c0ab670daf4416cf2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffff7f20000000000000000000000000000000008006b45b000000000000000000000000000000000000000000000000000000000000000000000000000000000101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff00ffffffff01000000000000000000000020801679e98561ada96caec2949a5d41c4cab3851eb740d951c10ecbcf265c1fd9000000000000000001ffffffffffffffff0000000000ffffffff02000000")

	// Encode the genesis block to raw bytes.
	params := RegNetParams()
	var buf bytes.Buffer
	err := params.GenesisBlock.Serialize(&buf)
	if err != nil {
		t.Fatalf("TestSimNetGenesisBlock: %v", err)
	}

	// Ensure the encoded block matches the expected bytes.
	if !bytes.Equal(buf.Bytes(), regNetGenesisBlockBytes) {
		t.Fatalf("TestRegNetGenesisBlock: Genesis block does not "+
			"appear valid - got %v, want %v",
			spew.Sdump(buf.Bytes()),
			spew.Sdump(regNetGenesisBlockBytes))
	}

	// Check hash of the block against expected hash.
	hash := params.GenesisBlock.BlockHash()
	if !params.GenesisHash.IsEqual(&hash) {
		t.Fatalf("TestRegNetGenesisBlock: Genesis block hash does "+
			"not appear valid - got %v, want %v", spew.Sdump(hash),
			spew.Sdump(params.GenesisHash))
	}
}
