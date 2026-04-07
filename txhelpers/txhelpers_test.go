package txhelpers

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"math/big"
	"strings"
	"testing"

	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	"github.com/monetarium/monetarium-node/cointype"
	"github.com/monetarium/monetarium-node/dcrutil"
	"github.com/monetarium/monetarium-node/wire"
)

type TxGetter struct {
	txLookup map[chainhash.Hash]*dcrutil.Tx
}

func (t TxGetter) GetRawTransaction(txHash *chainhash.Hash) (*dcrutil.Tx, error) {
	tx, ok := t.txLookup[*txHash]
	var err error
	if !ok {
		err = fmt.Errorf("tx not found")
	}
	return tx, err
}

// Utilities for creating test data:

func TxToWriter(tx *dcrutil.Tx, w io.Writer) error {
	msgTx := tx.MsgTx()
	binary.Write(w, binary.LittleEndian, int64(msgTx.SerializeSize()))
	msgTx.Serialize(w)
	binary.Write(w, binary.LittleEndian, tx.Tree())
	binary.Write(w, binary.LittleEndian, int64(tx.Index()))
	return nil
}

/*
// ConnectNodeRPC attempts to create a new websocket connection to a dcrd node,
// with the given credentials and optional notification handlers.
func ConnectNodeRPC(host, user, pass, cert string, disableTLS bool) (*rpcclient.Client, semver.Semver, error) {
	var dcrdCerts []byte
	var err error
	var nodeVer semver.Semver
	if !disableTLS {
		dcrdCerts, err = os.ReadFile(cert)
		if err != nil {
			return nil, nodeVer, err
		}
	}

	connCfgDaemon := &rpcclient.ConnConfig{
		Host:         host,
		Endpoint:     "ws", // websocket
		User:         user,
		Pass:         pass,
		Certificates: dcrdCerts,
		DisableTLS:   disableTLS,
	}

	dcrdClient, err := rpcclient.New(connCfgDaemon, nil)
	if err != nil {
		return nil, nodeVer, fmt.Errorf("Failed to start dcrd RPC client: %s", err.Error())
	}

	// Ensure the RPC server has a compatible API version.
	ver, err := dcrdClient.Version(context.TODO())
	if err != nil {
		return nil, nodeVer, fmt.Errorf("unable to get node RPC version")
	}

	dcrdVer := ver["dcrdjsonrpcapi"]
	nodeVer = semver.NewSemver(dcrdVer.Major, dcrdVer.Minor, dcrdVer.Patch)

	return dcrdClient, nodeVer, nil
}
*/

func TestFilterHashSlice(t *testing.T) {
	var hashList, blackList []chainhash.Hash
	var h *chainhash.Hash

	h, _ = chainhash.NewHashFromStr("8e5b17d75d1845f90940d07ac8338d0919f1cbd8e12e943c972322c628b47416")
	hashList = append(hashList, *h)
	h, _ = chainhash.NewHashFromStr("3365991083571c527bd3c81bd7374b6f06c17e67b50671067e78371e0511d1d5") // ***
	hashList = append(hashList, *h)
	h, _ = chainhash.NewHashFromStr("fd1a252947ee2ba7be5d0b197952640bdd74066a2a36f3c00beca34dbd3ac8ad")
	hashList = append(hashList, *h)

	h, _ = chainhash.NewHashFromStr("7ea06b193187dc028b6266ce49f4c942b3d57b4572991b527b5abd9ade4974b8")
	blackList = append(blackList, *h)
	h, _ = chainhash.NewHashFromStr("0839e25863e4d04b099d945d57180283e8be217ce6d7bc589c289bc8a1300804")
	blackList = append(blackList, *h)
	h, _ = chainhash.NewHashFromStr("3365991083571c527bd3c81bd7374b6f06c17e67b50671067e78371e0511d1d5") // *** [2]
	blackList = append(blackList, *h)
	h, _ = chainhash.NewHashFromStr("3edbc5318c36049d5fa70e6b04ef69b02d68e98c4739390c50220509a9803e26")
	blackList = append(blackList, *h)
	h, _ = chainhash.NewHashFromStr("37e032ece5ef4bda7b86c8b410476f3399d1ab48863d7d6279a66bea1e3876ab")
	blackList = append(blackList, *h)

	t.Logf("original: %v", hashList)

	hashList = FilterHashSlice(hashList, func(h chainhash.Hash) bool {
		return HashInSlice(h, blackList)
	})

	t.Logf("filtered: %v", hashList)

	if HashInSlice(blackList[2], hashList) {
		t.Errorf("filtered slice still has hash %v", blackList[2])
	}
}

func TestGenesisTxHash(t *testing.T) {
	// Mainnet
	genesisTxHash := GenesisTxHash(chaincfg.MainNetParams()).String()
	if genesisTxHash == "" {
		t.Errorf("Failed to get genesis transaction hash for mainnet.")
	}
	t.Logf("Genesis transaction hash (mainnet): %s", genesisTxHash)

	mainnetExpectedTxHash := "551ae7fd14ac57b004250291168b78dcb5fba73ae0e53d52b69bc2016d42ddf5"
	if genesisTxHash != mainnetExpectedTxHash {
		t.Errorf("Incorrect genesis transaction hash (mainnet). Expected %s, got %s",
			mainnetExpectedTxHash, genesisTxHash)
	}

	// Simnet
	genesisTxHash = GenesisTxHash(chaincfg.SimNetParams()).String()
	if genesisTxHash == "" {
		t.Errorf("Failed to get genesis transaction hash for simnet.")
	}
	t.Logf("Genesis transaction hash (simnet): %s", genesisTxHash)

	simnetExpectedTxHash := "3f0e0080def504a8d4c64a8af46336a0aba5052ee780994a0e9978a4450c7b44"
	if genesisTxHash != simnetExpectedTxHash {
		t.Errorf("Incorrect genesis transaction hash (simnet). Expected %s, got %s",
			simnetExpectedTxHash, genesisTxHash)
	}
}

func TestAddressErrors(t *testing.T) {
	if AddressErrorNoError != nil {
		t.Errorf("txhelpers.AddressErrorNoError must be <nil>")
	}
}

func TestIsZeroHashP2PHKAddress(t *testing.T) {
	mainnetDummy := "MsMfNmdbcherWznPacxufe9jSCMzRa1XDff"
	testnetDummy := "TsR28UZRprhgQQhzWns2M6cAwchrNVvbYq2"
	simnetDummy := "SsUMGgvWLcixEeHv3GT4TGYyez4kY79RHth"

	positiveTest := true
	negativeTest := !positiveTest

	testIsZeroHashP2PHKAddress(t, mainnetDummy, chaincfg.MainNetParams(), positiveTest)
	testIsZeroHashP2PHKAddress(t, testnetDummy, chaincfg.TestNet3Params(), positiveTest)
	testIsZeroHashP2PHKAddress(t, simnetDummy, chaincfg.SimNetParams(), positiveTest)

	// wrong network
	testIsZeroHashP2PHKAddress(t, mainnetDummy, chaincfg.SimNetParams(), negativeTest)
	testIsZeroHashP2PHKAddress(t, testnetDummy, chaincfg.MainNetParams(), negativeTest)
	testIsZeroHashP2PHKAddress(t, simnetDummy, chaincfg.TestNet3Params(), negativeTest)

	// wrong address
	testIsZeroHashP2PHKAddress(t, "", chaincfg.SimNetParams(), negativeTest)
	testIsZeroHashP2PHKAddress(t, "", chaincfg.MainNetParams(), negativeTest)
	testIsZeroHashP2PHKAddress(t, "", chaincfg.TestNet3Params(), negativeTest)
}

func testIsZeroHashP2PHKAddress(t *testing.T, expectedAddress string, params *chaincfg.Params, expectedTestResult bool) {
	result := IsZeroHashP2PHKAddress(expectedAddress, params)
	if expectedTestResult != result {
		t.Fatalf("IsZeroHashP2PHKAddress(%v) returned <%v>, expected <%v>",
			expectedAddress, result, expectedTestResult)
	}
}

func TestFeeRate(t *testing.T) {
	// Ensure invalid fee rate is -1.
	if FeeRate(0, 0, 0) != -1 {
		t.Errorf("Fee rate for 0 byte size must return -1.")
	}

	// (1-2)/500*1000 = -2
	expected := int64(-2)
	got := FeeRate(1, 2, 500)
	if got != expected {
		t.Errorf("Expected fee rate of %d, got %d.", expected, got)
	}

	// (10-0)/100*1000 = 100
	expected = int64(100)
	got = FeeRate(10, 0, 100)
	if got != expected {
		t.Errorf("Expected fee rate of %d, got %d.", expected, got)
	}

	// (10-10)/1e9*1000 = 0
	expected = int64(0)
	got = FeeRate(10, 10, 1e9)
	if got != expected {
		t.Errorf("Expected fee rate of %d, got %d.", expected, got)
	}
}

func randomHash() chainhash.Hash {
	var hash chainhash.Hash
	if _, err := rand.Read(hash[:]); err != nil {
		panic("boom")
	}
	return hash
}

func TestIsZeroHash(t *testing.T) {
	tests := []struct {
		name string
		hash chainhash.Hash
		want bool
	}{
		{"correctFromZeroByteArray", [chainhash.HashSize]byte{}, true},
		{"correctFromZeroValueHash", chainhash.Hash{}, true},
		{"incorrectByteArrayValues", [chainhash.HashSize]byte{0x22}, false},
		{"incorrectRandomHash", randomHash(), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsZeroHash(tt.hash); got != tt.want {
				t.Errorf("IsZeroHash() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsZeroHashStr(t *testing.T) {
	tests := []struct {
		name string
		hash string
		want bool
	}{
		{"correctFromStringsRepeat", strings.Repeat("00", chainhash.HashSize), true},
		{"correctFromZeroHashStringer", zeroHash.String(), true},
		{"correctFromZeroValueHashStringer", chainhash.Hash{}.String(), true},
		{"incorrectEmptyString", "", false},
		{"incorrectRandomHashString", randomHash().String(), false},
		{"incorrectNotAHashAtAll", "this is totally not a hash let alone the zero hash string", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsZeroHashStr(tt.hash); got != tt.want {
				t.Errorf("IsZeroHashStr() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMsgTxFromHex(t *testing.T) {
	tests := []struct {
		testName string
		txhex    string
		wantErr  bool
	}{
		{
			testName: "badHex",
			txhex:    "thisainthex",
			wantErr:  true, // encoding/hex: invalid byte: U+0074 't'
		},
		{
			testName: "partialTxHex",
			txhex: "0100000002000000000000000000000000000000000000000000000000000000" +
				"0000000000ffffffff00ffffffffcbc2bc0d947d8ebfa22ef060db230e3ecca0" +
				"8caa20e9eedcfc573dea71af2c940000000001ffffffff040000000000000000" +
				"0000266a2464e719ba6f832b4a51caf58a88cd4f6a57789f6cffe5c014000000" +
				"000000000070fd040000000000000000000000086a060100050000006e0d2100" +
				"0000000000001abb76a91414362cb17eb0295c03b051aad6abd87e31bd2fd0",
			wantErr: true, // unexpected EOF
		},
		{
			testName: "badTxType",
			txhex:    "0000002000000000000000000000000000000000000000000000000000000",
			wantErr:  true, // MsgTx.BtcDecode: unsupported transaction type
		},
	}
	for _, tt := range tests {
		t.Run(tt.testName, func(t *testing.T) {
			_, err := MsgTxFromHex(tt.txhex)
			if (err != nil) != tt.wantErr {
				t.Errorf("MsgTxFromHex() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestTotalOutFromMsgTx_Mixed(t *testing.T) {
	tx := wire.NewMsgTx()
	tx.AddTxOut(wire.NewTxOut(100_000_000, nil)) // 1 VAR
	tx.AddTxOut(wire.NewTxOut(50_000_000, nil))  // 0.5 VAR
	// SKA output — Value is 0, amount in SKAValue
	skaBig := new(big.Int).Mul(big.NewInt(1e6), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
	tx.AddTxOut(wire.NewTxOutSKA(skaBig, cointype.CoinType(1), nil))

	got := TotalOutFromMsgTx(tx)
	want := dcrutil.Amount(150_000_000)
	if got != want {
		t.Errorf("TotalOutFromMsgTx: want %d, got %d", want, got)
	}
}

func TestSKATotalsFromMsgTx(t *testing.T) {
	tx := wire.NewMsgTx()
	tx.AddTxOut(wire.NewTxOut(100_000_000, nil)) // VAR — should be ignored
	ska1 := new(big.Int).SetInt64(9e18)
	tx.AddTxOut(wire.NewTxOutSKA(ska1, cointype.CoinType(1), nil))
	ska1b := new(big.Int).SetInt64(1e18)
	tx.AddTxOut(wire.NewTxOutSKA(ska1b, cointype.CoinType(1), nil))

	got := SKATotalsFromMsgTx(tx)
	if got == nil {
		t.Fatal("expected non-nil SKATotals")
	}
	want := new(big.Int).Add(ska1, ska1b).String()
	if got[1] != want {
		t.Errorf("SKA-1 total: want %s, got %s", want, got[1])
	}
	if _, hasVAR := got[0]; hasVAR {
		t.Error("SKATotals should not contain VAR key")
	}
}

func TestSKATotalsFromMsgTx_VAROnly(t *testing.T) {
	tx := wire.NewMsgTx()
	tx.AddTxOut(wire.NewTxOut(100_000_000, nil))
	if got := SKATotalsFromMsgTx(tx); got != nil {
		t.Errorf("expected nil for VAR-only tx, got %v", got)
	}
}
