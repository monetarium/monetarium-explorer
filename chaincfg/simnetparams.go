// Copyright (c) 2014-2016 The btcsuite developers
// Copyright (c) 2015-2023 The Decred developers
// Use of this source code is governed by an ISC
// license that can be found in the LICENSE file.

package chaincfg

import (
	"math"
	"math/big"
	"time"

	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/dcrec/secp256k1"
	"github.com/monetarium/monetarium-node/wire"
)

// SimNetParams returns the network parameters for the simulation test network.
// This network is similar to the normal test network except it is intended for
// private use within a group of individuals doing simulation testing and full
// integration tests between different applications such as wallets, voting
// service providers, mining pools, block explorers, and other services that
// build on Decred.
//
// The functionality is intended to differ in that the only nodes which are
// specifically specified are used to create the network rather than following
// normal discovery rules.  This is important as otherwise it would just turn
// into another public testnet.
func SimNetParams() *Params {
	// simNetPowLimit is the highest proof of work value a Decred block can have
	// for the simulation test network.  It is the value 2^255 - 1.
	simNetPowLimit := new(big.Int).Sub(new(big.Int).Lsh(bigOne, 255), bigOne)

	// simNetPowLimitBits is the simulation test network proof of work limit in
	// its compact representation.
	//
	// Note that due to the limited precision of the compact representation,
	// this is not exactly equal to the pow limit.  It is the value:
	//
	// 0x7fffff0000000000000000000000000000000000000000000000000000000000
	const simNetPowLimitBits = 0x207fffff // 545259519

	// genesisBlock defines the genesis block of the block chain which serves
	// as the public transaction ledger for the simulation test network.
	genesisBlock := wire.MsgBlock{
		Header: wire.BlockHeader{
			Version:   1,
			PrevBlock: chainhash.Hash{}, // All zero.
			// MerkleRoot: Calculated below.
			StakeRoot:    chainhash.Hash{}, // All zero.
			VoteBits:     0,
			FinalState:   [6]byte{}, // All zero.
			Voters:       0,
			FreshStake:   0,
			Revocations:  0,
			Timestamp:    time.Unix(1401292357, 0), // 2014-05-28 15:52:37 +0000 UTC
			PoolSize:     0,
			Bits:         simNetPowLimitBits,
			SBits:        0,
			Nonce:        0,
			StakeVersion: 0,
			Height:       0,
		},
		Transactions: []*wire.MsgTx{{
			SerType: wire.TxSerializeFull,
			Version: 1,
			TxIn: []*wire.TxIn{{
				PreviousOutPoint: wire.OutPoint{
					Hash:  chainhash.Hash{},
					Index: 0xffffffff,
				},
				SignatureScript: hexDecode("04ffff001d0104455468652054696d65" +
					"732030332f4a616e2f32303039204368616e63656c6c6f72206f6e" +
					"206272696e6b206f66207365636f6e64206261696c6f757420666f" +
					"722062616e6b73"),
				Sequence: 0xffffffff,
			}},
			TxOut: []*wire.TxOut{{
				Value:    0x00000000,
				CoinType: cointype.CoinTypeVAR,
				Version:  0,
				PkScript: hexDecode("4104678afdb0fe5548271967f1a67130b7105c" +
					"d6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e5" +
					"1ec112de5c384df7ba0b8d578a4c702b6bf11d5fac"),
			}},
			LockTime: 0,
			Expiry:   0,
		}},
	}
	genesisBlock.Header.MerkleRoot = genesisBlock.Transactions[0].TxHashFull()

	return &Params{
		Name:        "simnet",
		Net:         wire.SimNet,
		DefaultPort: "18955",
		DNSSeeds:    nil, // NOTE: There must NOT be any seeds.

		// Chain parameters
		GenesisBlock:         &genesisBlock,
		GenesisHash:          genesisBlock.BlockHash(),
		PowLimit:             simNetPowLimit,
		PowLimitBits:         simNetPowLimitBits,
		ReduceMinDifficulty:  false,
		MinDiffReductionTime: 0, // Does not apply since ReduceMinDifficulty false
		GenerateSupported:    true,
		MaximumBlockSizes:    []int{393216, 493216},
		MaxTxSize:            393216,
		TargetTimePerBlock:   time.Second,

		// Version 1 difficulty algorithm (EMA + BLAKE256) parameters.
		WorkDiffAlpha:            1,
		WorkDiffWindowSize:       8,
		WorkDiffWindows:          4,
		TargetTimespan:           time.Second * 8, // TimePerBlock * WindowSize
		RetargetAdjustmentFactor: 4,

		// Version 2 difficulty algorithm (ASERT + BLAKE3) parameters.
		WorkDiffV2Blake3StartBits: simNetPowLimitBits,
		WorkDiffV2HalfLifeSecs:    6, // 6 * TimePerBlock

		// Subsidy parameters.
		BaseSubsidy:              6400000000, // 64 VAR per block (same as mainnet)
		MulSubsidy:               1,          // Numerator for halving (1/2)
		DivSubsidy:               2,          // Denominator for halving (1/2)
		SubsidyReductionInterval: 128,        // Fast halving for testing
		WorkRewardProportion:     6,
		WorkRewardProportionV2:   5,
		StakeRewardProportion:    3,
		StakeRewardProportionV2:  5,
		BlockTaxProportion:       0,

		// AssumeValid is the hash of a block that has been externally verified
		// to be valid.  It is also used to determine the old forks rejection
		// checkpoint.
		//
		// Not set for simnet test network since its chain is dynamic.
		AssumeValid: chainhash.Hash{},

		// MinKnownChainWork is the minimum amount of known total work for the
		// chain at a given point in time.
		//
		// Not set for simnet test network since its chain is dynamic.
		MinKnownChainWork: nil,

		// Consensus rule change deployments.
		//
		// The miner confirmation window is defined as:
		//   target proof of work timespan / target proof of work spacing
		RuleChangeActivationQuorum:     5, // 10 % of RuleChangeActivationInterval * TicketsPerBlock (5 votes for 10 blocks * 5 tickets)
		RuleChangeActivationMultiplier: 3, // 75%
		RuleChangeActivationDivisor:    4,
		RuleChangeActivationInterval:   10, // 10 blocks for fast testing (was 320)
		Deployments: map[uint32][]ConsensusDeployment{
			4: {{
				Vote: Vote{
					Id:          VoteIDMaxBlockSize,
					Description: "Change maximum allowed block size from 1MiB to 1.25MB",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "reject changing max allowed block size",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "accept changing max allowed block size",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			5: {{
				Vote: Vote{
					Id:          VoteIDSDiffAlgorithm,
					Description: "Change stake difficulty algorithm as defined in DCP0001",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing algorithm",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new algorithm",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			6: {{
				Vote: Vote{
					Id:          VoteIDLNFeatures,
					Description: "Enable features defined in DCP0002 and DCP0003 necessary to support Lightning Network (LN)",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			7: {{
				Vote: Vote{
					Id:          VoteIDFixLNSeqLocks,
					Description: "Modify sequence lock handling as defined in DCP0004",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			8: {{
				Vote: Vote{
					Id:          VoteIDHeaderCommitments,
					Description: "Enable header commitments as defined in DCP0005",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			9: {{
				Vote: Vote{
					Id:          VoteIDTreasury,
					Description: "Enable decentralized Treasury opcodes as defined in DCP0006",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			10: {{
				Vote: Vote{
					Id:          VoteIDRevertTreasuryPolicy,
					Description: "Change maximum treasury expenditure policy as defined in DCP0007",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}, {
				Vote: Vote{
					Id:          VoteIDExplicitVersionUpgrades,
					Description: "Enable explicit version upgrades as defined in DCP0008",
					Mask:        0x0018, // Bits 3 and 4
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain from voting",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0008, // Bit 3
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0010, // Bit 4
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}, {
				Vote: Vote{
					Id:          VoteIDAutoRevocations,
					Description: "Enable automatic ticket revocations as defined in DCP0009",
					Mask:        0x0060, // Bits 5 and 6
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0020, // Bit 5
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0040, // Bit 6
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}, {
				Vote: Vote{
					Id:          VoteIDChangeSubsidySplit,
					Description: "Change block reward subsidy split to 10/80/10 as defined in DCP0010",
					Mask:        0x0180, // Bits 7 and 8
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain from voting",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0080, // Bit 7
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0100, // Bit 8
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			11: {{
				Vote: Vote{
					Id:          VoteIDBlake3Pow,
					Description: "Change proof of work hashing algorithm to BLAKE3 as defined in DCP0011",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}, {
				Vote: Vote{
					Id:          VoteIDChangeSubsidySplitR2,
					Description: "Change block reward subsidy split to 1/89/10 as defined in DCP0012",
					Mask:        0x0060, // Bits 5 and 6
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain voting for change",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep the existing consensus rules",
						Bits:        0x0020, // Bit 5
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "change to the new consensus rules",
						Bits:        0x0040, // Bit 6
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				ForcedChoiceID: "yes",
				StartTime:      0,             // Always available for vote
				ExpireTime:     math.MaxInt64, // Never expires
			}},
			12: {{
				Vote: Vote{
					Id:          VoteIDActivateSKA2,
					Description: "Activate SKA-2 (Skarb-2) coin type for transactions",
					Mask:        0x0006, // Bits 1 and 2
					Choices: []Choice{{
						Id:          "abstain",
						Description: "abstain from voting",
						Bits:        0x0000,
						IsAbstain:   true,
						IsNo:        false,
					}, {
						Id:          "no",
						Description: "keep SKA-2 inactive",
						Bits:        0x0002, // Bit 1
						IsAbstain:   false,
						IsNo:        true,
					}, {
						Id:          "yes",
						Description: "activate SKA-2 for use",
						Bits:        0x0004, // Bit 2
						IsAbstain:   false,
						IsNo:        false,
					}},
				},
				StartTime:  0,             // Immediately available for vote
				ExpireTime: math.MaxInt64, // Never expires
			}},
		},

		// Enforce current block version once majority of the network has
		// upgraded.
		// 51% (51 / 100)
		// Reject previous block versions once a majority of the network has
		// upgraded.
		// 75% (75 / 100)
		BlockEnforceNumRequired: 51,
		BlockRejectNumRequired:  75,
		BlockUpgradeNumToCheck:  100,

		// AcceptNonStdTxs is a mempool param to either accept and relay non
		// standard txs to the network or reject them
		AcceptNonStdTxs: true,

		// Address encoding magics
		NetworkAddressPrefix: "S",
		PubKeyAddrID:         [2]byte{0x27, 0x6f}, // starts with Sk
		PubKeyHashAddrID:     [2]byte{0x0e, 0x91}, // starts with Ss
		PKHEdwardsAddrID:     [2]byte{0x0e, 0x71}, // starts with Se
		PKHSchnorrAddrID:     [2]byte{0x0e, 0x53}, // starts with SS
		ScriptHashAddrID:     [2]byte{0x0e, 0x6c}, // starts with Sc
		PrivateKeyID:         [2]byte{0x23, 0x07}, // starts with Ps

		// BIP32 hierarchical deterministic extended key magics
		HDPrivateKeyID: [4]byte{0x04, 0x20, 0xb9, 0x03}, // starts with sprv
		HDPublicKeyID:  [4]byte{0x04, 0x20, 0xbd, 0x3d}, // starts with spub

		// BIP44 coin type used in the hierarchical deterministic path for
		// address generation.
		SLIP0044CoinType: 1,   // SLIP0044, Testnet (all coins)
		LegacyCoinType:   115, // ASCII for s, for backwards compatibility

		// Decred PoS parameters
		MinimumStakeDiff:        20000,
		TicketPoolSize:          64,
		TicketsPerBlock:         5,
		TicketMaturity:          16,
		TicketExpiry:            384, // 6*TicketPoolSize
		CoinbaseMaturity:        16,
		SStxChangeMaturity:      1,
		TicketPoolSizeWeight:    4,
		StakeDiffAlpha:          1,
		StakeDiffWindowSize:     8,
		StakeDiffWindows:        8,
		StakeVersionInterval:    8 * 2 * 7,     // 112 blocks
		MaxFreshStakePerBlock:   20,            // 4*TicketsPerBlock
		StakeEnabledHeight:      16 + 16,       // CoinbaseMaturity + TicketMaturity
		StakeValidationHeight:   16 + (64 * 2), // CoinbaseMaturity + TicketPoolSize*2
		StakeBaseSigScript:      []byte{0x00, 0x00},
		StakeMajorityMultiplier: 3,
		StakeMajorityDivisor:    4,

		// Decred organization related parameters
		//
		// Treasury address is a 3-of-3 P2SH going to a wallet with seed:
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// aardvark adroitness aardvark adroitness
		// briefcase
		// (seed 0x0000000000000000000000000000000000000000000000000000000000000000)
		//
		// This same wallet owns the three ledger outputs for simnet.
		//
		// P2SH details for simnet treasury:
		//
		// redeemScript: 532103e8c60c7336744c8dcc7b85c27789950fc52aa4e48f895ebbfb
		// ac383ab893fc4c2103ff9afc246e0921e37d12e17d8296ca06a8f92a07fbe7857ed1d4
		// f0f5d94e988f21033ed09c7fa8b83ed53e6f2c57c5fa99ed2230c0d38edf53c0340d0f
		// c2e79c725a53ae
		//   (3-of-3 multisig)
		// Pubkeys used:
		//   SkQmxbeuEFDByPoTj41TtXat8tWySVuYUQpd4fuNNyUx51tF1csSs
		//   SkQn8ervNvAUEX5Ua3Lwjc6BAuTXRznDoDzsyxgjYqX58znY7w9e4
		//   SkQkfkHZeBbMW8129tZ3KspEh1XBFC1btbkgzs6cjSyPbrgxzsKqk
		//
		// Monetarium has no treasury (BlockTaxProportion = 0)
		OrganizationPkScript:        nil,
		OrganizationPkScriptVersion: 0,
		BlockOneLedger:              nil,

		// Commands to generate simnet Pi keys:
		// $ treasurykey.go -simnet
		// Private key: 62deae1ab2b1ebd96a28c80e870aee325bed359e83d8db2464ef999e616a9eef
		// Public  key: 02a36b785d584555696b69d1b2bbeff4010332b301e3edd316d79438554cacb3e7
		// WIF        : PsUUktzTqNKDRudiz3F4Chh5CKqqmp5W3ckRDhwECbwrSuWZ9m5fk
		//
		// $ treasurykey.go -simnet
		// Private key: cc0d8258d68acf047732088e9b70e2c97c53f711518042d267fc6975f39b791b
		// Public  key: 02b2c110e7b560aa9e1545dd18dd9f7e74a3ba036297a696050c0256f1f69479d7
		// WIF        : PsUVZDkMHvsH8RmYtCxCWs78xsLU9qAyZyLvV9SJWAdoiJxSFhvFx
		PiKeys: [][]byte{
			hexDecode("02a36b785d584555696b69d1b2bbeff4010332b301e3edd316d79438554cacb3e7"),
			hexDecode("02b2c110e7b560aa9e1545dd18dd9f7e74a3ba036297a696050c0256f1f69479d7"),
		},

		TreasuryVoteInterval:           16 * 3, // 3 times coinbase (48 blocks).
		TreasuryVoteIntervalMultiplier: 3,      // 3 * 48 block Expiry.

		TreasuryExpenditureWindow:    4,         // 4 * 2 * 48 blocks for policy check
		TreasuryExpenditurePolicy:    3,         // Avg of 3*4*2*48 blocks for policy check
		TreasuryExpenditureBootstrap: 100 * 1e8, // 100 dcr/tew as expense bootstrap

		TreasuryVoteQuorumMultiplier:   1, // 20% quorum required
		TreasuryVoteQuorumDivisor:      5,
		TreasuryVoteRequiredMultiplier: 3, // 60% yes votes required
		TreasuryVoteRequiredDivisor:    5,

		seeders: nil, // NOTE: There must NOT be any seeds.

		// SKA coin type configurations for simnet testing
		// NOTE: Simnet uses same 900 trillion supply as mainnet for realistic testing.
		// All amounts use big.Int via TxOut.SKAValue for large emissions.
		SKACoins: map[cointype.CoinType]*SKACoinConfig{
			1: {
				CoinType:         1,
				Name:             "Skarb-1",
				Symbol:           "SKA-1",
				MaxSupply:        mustParseBigInt("900000000000000000000000000000000"), // 900T * 1e18 atoms (900 trillion SKA coins)
				AtomsPerCoin:     mustParseBigInt("1000000000000000000"),               // 1e18
				EmissionHeight:   150,                                                  // After stake validation (144)
				EmissionWindow:   100,                                                  // 100-block emission window for testing
				Active:           true,
				Description:      "Primary SKA coin type for simnet testing",
				MinRelayTxFee:    mustParseBigInt("4000000000000000000"), // 4 SKA per KB (4e18 atoms/KB)
				MaxFeeMultiplier: 2500,                                   // Max fee is 2500x min fee
				// Governance-approved emission distribution for simnet testing
				EmissionAddresses: []string{
					"SsWKp7wtdTZYabYFYSc9cnxhwFEjA5g4pFc", // Full amount to treasury for testing
					// Priv key: PsUQzmmSVH2Ry6tGp9NygLRdLAXsRGio9EV4B23sqdYHFer3j7Fhb
				},
				EmissionAmounts: bigIntSlice(
					"900000000000000000000000000000000", // 900T * 1e18 atoms (900 trillion SKA coins) to treasury
				),
				// SIMNET TEST KEY - NOT FOR PRODUCTION USE
				EmissionKey: mustParseHexPubKeySimnet("02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"),
			},
			2: {
				CoinType:         2,
				Name:             "Skarb-2",
				Symbol:           "SKA-2",
				MaxSupply:        mustParseBigInt("500000000000000000"),  // 5e17 atoms (0.5 SKA for testing)
				AtomsPerCoin:     mustParseBigInt("1000000000000000000"), // 1e18
				EmissionHeight:   200,                                    // After vote activation and test script completion
				EmissionWindow:   100,                                    // 100-block emission window for testing
				Active:           false,                                  // Initially inactive, activated by stakeholder vote
				Description:      "Secondary SKA coin type requiring stakeholder vote activation for simnet testing",
				MinRelayTxFee:    mustParseBigInt("4000000000000000000"), // 4 SKA per KB (4e18 atoms/KB)
				MaxFeeMultiplier: 2500,                                   // Max fee is 2500x min fee
				// Governance-approved emission distribution for simnet testing
				EmissionAddresses: []string{
					"SsWKp7wtdTZYabYFYSc9cnxhwFEjA5g4pFc", // Full amount to treasury
				},
				EmissionAmounts: bigIntSlice(
					"500000000000000000", // 5e17 atoms (0.5 SKA) to treasury
				),
				// SIMNET TEST KEY - NOT FOR PRODUCTION USE
				EmissionKey: mustParseHexPubKeySimnet("02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13"),
			},
		},

		// Initial SKA types to activate at simnet genesis
		InitialSKATypes: []cointype.CoinType{1}, // Only SKA-1 initially active
	}
}

// mustParseHexPubKeySimnet parses a hex-encoded public key for simnet testing.
// SIMNET ONLY - These are test keys and must not be used in production.
func mustParseHexPubKeySimnet(hexStr string) *secp256k1.PublicKey {
	keyBytes := mustParseHex(hexStr)
	pubKey, err := secp256k1.ParsePubKey(keyBytes)
	if err != nil {
		panic("failed to parse simnet test public key: " + err.Error())
	}
	return pubKey
}
