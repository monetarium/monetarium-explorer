// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package pubsub

import (
	"errors"
	"testing"
	"time"

	pstypes "github.com/monetarium/monetarium-explorer/pubsub/types"
)

// TestWebsocketHubEvictsSlowClient verifies that sendMsg evicts a client
// whose spoke buffer is full, instead of blocking the hub's Run loop.
func TestWebsocketHubEvictsSlowClient(t *testing.T) {
	hub := NewWebsocketHub()
	go hub.Run()
	t.Cleanup(hub.Stop)

	// Register a client and wait for registration to complete.
	ch := hub.NewClientHubSpoke()
	time.Sleep(50 * time.Millisecond)

	if n := hub.NumClients(); n != 1 {
		t.Fatalf("expected 1 client at start, got %d", n)
	}

	// Subscribe to sigPingAndUserCount so the subscription loop delivers
	// to the client.
	if _, err := ch.cl.subscribe(pstypes.HubMessage{Signal: sigPingAndUserCount}); err != nil {
		t.Fatal(err)
	}

	// Fill the spoke buffer completely using direct sends to bypass
	// the Run loop. This isolates the sendMsg eviction logic.
	for i := 0; i < 64; i++ {
		*ch.c <- pstypes.HubMessage{Signal: sigPingAndUserCount}
	}

	// Now the spoke buffer is full. Trigger a HubRelay message so that
	// the Run loop's sendMsg attempts to send to the full spoke, which
	// should hit the default branch and evict the client.
	hub.HubRelay <- pstypes.HubMessage{Signal: sigPingAndUserCount}
	time.Sleep(50 * time.Millisecond)

	if n := hub.NumClients(); n != 0 {
		t.Errorf("expected 0 clients (evicted), got %d (spoke len=%d)",
			n, len(*ch.c))
	}

	// Drain buffered messages, then verify spoke is closed.
	for len(*ch.c) > 0 {
		<-*ch.c
	}
	time.Sleep(time.Millisecond)
	select {
	case _, ok := <-*ch.c:
		if ok {
			t.Error("channel should be closed (drained + evicted)")
		}
	default:
		t.Error("channel should be closed but non-blocking receive blocks")
	}
}

// TestWebsocketHubEvictsSlowClientViaHubRelay verifies that filling the
// spoke buffer entirely through HubRelay messages also triggers eviction.
// HubRelay is unbuffered, so each hub.HubRelay <- msg returns as soon as
// the Run loop picks the message up in its select, but BEFORE the
// sendToAll → sendMsg call chain actually writes to the spoke.  Sending
// one extra message (66 total for a capacity-64 spoke) acts as a sync
// point: by the time the 66th send returns we know the 65th (which triggers
// eviction) has been fully processed.
func TestWebsocketHubEvictsSlowClientViaHubRelay(t *testing.T) {
	hub := NewWebsocketHub()
	go hub.Run()
	t.Cleanup(hub.Stop)

	ch := hub.NewClientHubSpoke()
	time.Sleep(50 * time.Millisecond)

	if n := hub.NumClients(); n != 1 {
		t.Fatalf("expected 1 client at start, got %d", n)
	}

	// bufCap + 2: 64 fill the buffer, the 65th triggers eviction via
	// sendMsg's default branch, and the 66th is a no-op (no clients)
	// that lets us know the 65th has been fully processed.
	for i := 0; i < 66; i++ {
		hub.HubRelay <- pstypes.HubMessage{Signal: sigPingAndUserCount}
	}

	if n := hub.NumClients(); n != 0 {
		t.Errorf("expected 0 clients (evicted), got %d (spoke len=%d)",
			n, len(*ch.c))
	}

	// Drain then verify closed.
	for len(*ch.c) > 0 {
		<-*ch.c
	}
	select {
	case _, ok := <-*ch.c:
		if ok {
			t.Error("channel should be closed (drained + evicted)")
		}
	default:
		t.Error("channel should be closed but non-blocking receive blocks")
	}
}

func Test_client_subscribe(t *testing.T) {
	tests := []struct {
		name    string
		cl      *client
		hubMsg  pstypes.HubMessage
		wantErr error
		wantOK  bool
	}{
		{"ping not a sub", newClient(), pstypes.HubMessage{Signal: sigPingAndUserCount}, nil, false},
		{"ok newtx", newClient(), pstypes.HubMessage{Signal: sigNewTx}, nil, true},
		{"ok addr", newClient(), pstypes.HubMessage{
			Signal: sigAddressTx,
			Msg:    &pstypes.AddressMessage{Address: "DsfX4WrSecUwGoRd9B7Lz1JjYssYaVKnjGC"},
		}, nil, true},
		{"bad addr", newClient(), pstypes.HubMessage{
			Signal: sigAddressTx,
			Msg:    pstypes.AddressMessage{Address: "DsfX4WrSecUwGoRd9B7Lz1JjYssYaVKnjGC"},
		}, errors.New("msg.Msg not a string (SigAddressTx): types.AddressMessage"), false},
		{"bad addr", newClient(), pstypes.HubMessage{
			Signal: sigAddressTx,
			Msg:    nil,
		}, errors.New("msg.Msg not a string (SigAddressTx): <nil>"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, err := tt.cl.subscribe(tt.hubMsg)
			if (err != nil) != (tt.wantErr != nil) ||
				(err != nil && err.Error() != tt.wantErr.Error()) {
				t.Errorf(`subscribe() error = "%v", wantErr "%v"`, err, tt.wantErr)
				return
			}
			if ok != tt.wantOK {
				t.Errorf("Did not subscribe to %v.", tt.hubMsg)
			}
		})
	}
}
