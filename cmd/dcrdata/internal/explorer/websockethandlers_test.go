package explorer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/monetarium/monetarium-explorer/explorer/types"
)

// waitForClients polls the hub's client count until it reaches want or the
// deadline passes. Registration and teardown happen asynchronously through the
// hub's run loop, so a poll is the reliable way to observe the count settle.
func waitForClients(t *testing.T, hub *WebsocketHub, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if hub.NumClients() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for NumClients()=%d, last saw %d", want, hub.NumClients())
}

// TestRootWebsocket_ReconnectLeavesNoLeak exercises a full
// disconnect -> reconnect cycle against the explorer /ws handler and asserts
// that the hub's client count returns to baseline each time. This locks in the
// contract the frontend's reconnecting client relies on: each reconnect is a
// fresh, cleanly-registered client, and a dropped client is fully unregistered
// (no leaked client/goroutine).
func TestRootWebsocket_ReconnectLeavesNoLeak(t *testing.T) {
	hub := NewWebsocketHub()
	go hub.run()
	t.Cleanup(hub.Stop)

	exp := &explorerUI{wsHub: hub}
	srv := httptest.NewServer(http.HandlerFunc(exp.RootWebsocket))
	t.Cleanup(srv.Close)
	wsURL := "ws://" + strings.TrimPrefix(srv.URL, "http://")

	dial := func() *websocket.Conn {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		conn, _, err := websocket.Dial(ctx, wsURL, nil)
		if err != nil {
			t.Fatalf("websocket.Dial(%s) failed: %v", wsURL, err)
		}
		return conn
	}

	// Initial connection registers exactly one client.
	conn1 := dial()
	waitForClients(t, hub, 1)

	// Dropping the socket unregisters it.
	if err := conn1.Close(websocket.StatusNormalClosure, "drop"); err != nil {
		t.Fatalf("first close failed: %v", err)
	}
	waitForClients(t, hub, 0)

	// Reconnecting with a brand-new socket registers cleanly again — no stale
	// state, no leaked client from the previous connection.
	conn2 := dial()
	waitForClients(t, hub, 1)

	if err := conn2.Close(websocket.StatusNormalClosure, "drop"); err != nil {
		t.Fatalf("second close failed: %v", err)
	}
	waitForClients(t, hub, 0)
}

// TestRootWebsocket_GetMempoolTrimmedBeforeReady reproduces a server-wide panic:
// a client requesting "getmempooltrimmed" during the startup window — before the
// first block has been collected and pageData.BlockchainInfo is still nil — must
// not crash the read loop. The frontend's visualblocks controller issues this
// request on a mempool push and on reconnect, so it is reachable immediately
// after a client connects.
func TestRootWebsocket_GetMempoolTrimmedBeforeReady(t *testing.T) {
	hub := NewWebsocketHub()
	go hub.run()
	t.Cleanup(hub.Stop)

	// BlockchainInfo/HomeInfo are nil until the first block is stored.
	exp := &explorerUI{
		wsHub:    hub,
		pageData: &pageData{},
		invs:     new(types.MempoolInfo),
	}
	srv := httptest.NewServer(http.HandlerFunc(exp.RootWebsocket))
	t.Cleanup(srv.Close)
	wsURL := "ws://" + strings.TrimPrefix(srv.URL, "http://")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%s) failed: %v", wsURL, err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "") })
	waitForClients(t, hub, 1)

	// Must not panic the server even though BlockchainInfo is still nil.
	if err := wsjson.Write(ctx, conn, WebSocketMessage{EventId: "getmempooltrimmed"}); err != nil {
		t.Fatalf("write getmempooltrimmed failed: %v", err)
	}

	// Liveness probe: a subsequent request that does produce a response proves
	// the read loop survived (rather than panicking the whole process).
	if err := wsjson.Write(ctx, conn, WebSocketMessage{EventId: "getmempooltxs"}); err != nil {
		t.Fatalf("write getmempooltxs failed: %v", err)
	}
	var resp WebSocketMessage
	if err := wsjson.Read(ctx, conn, &resp); err != nil {
		t.Fatalf("read response failed (server likely crashed): %v", err)
	}
	if resp.EventId != "getmempooltxsResp" {
		t.Fatalf("unexpected response event %q, want getmempooltxsResp", resp.EventId)
	}
}
