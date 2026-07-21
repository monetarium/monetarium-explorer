// Copyright (c) 2019-2021, The Decred developers

package notification

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/monetarium/monetarium-explorer/txhelpers"
	"github.com/monetarium/monetarium-node/chaincfg/chainhash"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/wire"
)

type dummyNode struct{}

func (node *dummyNode) NotifyBlocks(context.Context) error                { return nil }
func (node *dummyNode) NotifyNewTransactions(context.Context, bool) error { return nil }
func (node *dummyNode) NotifyWinningTickets(context.Context) error        { return nil }

var counter int64
var hashTails = []string{"00", "01", "02", "03", "04", "05", "06", "07", "08", "09"}

func newHash() *chainhash.Hash {
	counter++
	h, _ := chainhash.NewHash([]byte("000000000000000000000000000000" + hashTails[int(counter)%len(hashTails)]))
	return h
}

func (node *dummyNode) GetBestBlock(context.Context) (*chainhash.Hash, int64, error) {
	hash := newHash()
	return hash, counter, nil
}

var commonAncestorHash = newHash()
var commonAncestor = &wire.MsgBlock{
	Header: wire.BlockHeader{
		PrevBlock: *commonAncestorHash,
		Height:    uint32(5),
	},
}

// GetBlock will only be called by rpcutils.CommonAncestor, so it should return
// the same block every time.
func (node *dummyNode) GetBlock(_ context.Context, blockHash *chainhash.Hash) (*wire.MsgBlock, error) {
	return commonAncestor, nil
}
func (node *dummyNode) GetBlockHash(_ context.Context, blockHeight int64) (*chainhash.Hash, error) {
	hash := newHash()
	return hash, nil
}
func (node *dummyNode) GetBlockHeaderVerbose(_ context.Context, hash *chainhash.Hash) (*chainjson.GetBlockHeaderVerboseResult, error) {
	return nil, nil
}

var callCounter int

// testTxHandler will be tested async
var mtx sync.RWMutex
var wg = new(sync.WaitGroup)
var notifier *Notifier

func testTxHandler(_ *chainjson.TxRawResult) error {
	mtx.Lock()
	defer mtx.Unlock()
	defer wg.Done()
	callCounter++
	return nil
}

var testTxHandler2 = testTxHandler

func testBlockHandler(_ *wire.BlockHeader) error {
	defer wg.Done()
	callCounter++
	return nil
}
func testBlockHandlerLite(_ uint32, _ string) error {
	defer wg.Done()
	callCounter++
	return nil
}
func testReorgHandler(reorg *txhelpers.ReorgData) error {
	defer wg.Done()
	callCounter++
	notifier.SetPreviousBlock(reorg.NewChainHead, uint32(reorg.NewChainHeight))
	return nil
}

// TestProcessBlockAdvancesPreviousOnTimeout verifies that processBlock
// always calls SetPreviousBlock even when a handler group exceeds the
// SyncHandlerDeadline, preventing permanent chain desync.
func TestProcessBlockAdvancesPreviousOnTimeout(t *testing.T) {
	oldDeadline := SyncHandlerDeadline
	SyncHandlerDeadline = 10 * time.Millisecond
	defer func() { SyncHandlerDeadline = oldDeadline }()

	n := NewNotifier()

	// Register a handler that blocks forever.
	blocked := make(chan struct{})
	n.RegisterBlockHandlerGroup(func(_ *wire.BlockHeader) error {
		<-blocked
		return nil
	})

	prevBlock := newHash()
	header := wire.BlockHeader{
		PrevBlock: *prevBlock,
		Height:    uint32(100),
	}
	n.previous.hash = *prevBlock

	start := time.Now()
	n.processBlock(&header)
	elapsed := time.Since(start)

	if elapsed > 5*time.Second {
		t.Fatalf("processBlock took %v, expected << 5s (deadline was %v)", elapsed, SyncHandlerDeadline)
	}

	if n.previous.hash != header.BlockHash() {
		t.Errorf("previous.hash not advanced after timeout: got %v, want %v",
			n.previous.hash, header.BlockHash())
	}
	if n.previous.height != header.Height {
		t.Errorf("previous.height not advanced after timeout: got %d, want %d",
			n.previous.height, header.Height)
	}
}

func TestNotifier(t *testing.T) {

	notifier = NewNotifier()
	signals := notifier.DcrdHandlers()
	notifier.RegisterTxHandlerGroup(testTxHandler, testTxHandler2)
	notifier.RegisterBlockHandlerGroup(testBlockHandler)
	notifier.RegisterBlockHandlerLiteGroup(testBlockHandlerLite)
	notifier.RegisterReorgHandlerGroup(testReorgHandler)
	wg.Add(5)

	ctx, shutdown := context.WithCancel(context.Background())
	defer shutdown()

	notifier.Listen(ctx, &dummyNode{})

	prevBlock := newHash()
	header := wire.BlockHeader{
		PrevBlock: *prevBlock,
		Height:    uint32(counter),
	}
	notifier.previous.hash = *prevBlock
	bytes, _ := header.Bytes()
	signals.OnBlockConnected(bytes, nil)

	oldHash := newHash()
	ohdHeight := int32(counter)
	newHash := newHash()
	newHeight := counter
	signals.OnReorganization(oldHash, ohdHeight, newHash, int32(newHeight))

	signals.OnTxAcceptedVerbose(new(chainjson.TxRawResult))

	wg.Wait()

	if notifier.previous.hash.String() != newHash.String() {
		t.Errorf("unexpected previous.hash after reorg. %s != %s",
			notifier.previous.hash.String(), newHash.String())
	}

	if notifier.previous.height != uint32(newHeight) {
		t.Errorf("unexpected previous.height after reorg. %d != %d",
			notifier.previous.height, uint32(newHeight))
	}

	if callCounter != 5 {
		t.Errorf("callCounter = %d. Should be 5.", callCounter)
	}

	shutdown()
}
