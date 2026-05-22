// Copyright (c) 2026, The Monetarium developers
// See LICENSE for details.

package pubsub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	pstypes "github.com/monetarium/monetarium-explorer/pubsub/types"
)

// newWSTestHub builds a PubSubHub stripped of its data source dependencies —
// enough to drive WebSocketHandler through subscribe/version round-trips
// without needing a real chain backend. The hub goroutine is started and
// shut down via t.Cleanup.
func newWSTestHub(t *testing.T) *PubSubHub {
	t.Helper()
	psh := &PubSubHub{
		wsHub: NewWebsocketHub(),
		ver:   pstypes.NewVer(version.Split()),
	}
	go psh.wsHub.Run()
	t.Cleanup(func() {
		psh.wsHub.Stop()
	})
	return psh
}

// wsTestServer wraps WebSocketHandler in an httptest.Server and returns the
// ws:// URL clients should dial.
func wsTestServer(t *testing.T, psh *PubSubHub) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(psh.WebSocketHandler))
	t.Cleanup(srv.Close)
	return "ws://" + strings.TrimPrefix(srv.URL, "http://")
}

// dialWS opens a coder/websocket client connection to wsURL with a short
// dial timeout.
func dialWS(t *testing.T, ctx context.Context, wsURL string) *websocket.Conn {
	t.Helper()
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(dialCtx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%s) failed: %v", wsURL, err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "") })
	return conn
}

// sendRequest marshals a RequestMessage with the given event into a
// WebSocketMessage and writes it over the connection.
func sendRequest(t *testing.T, ctx context.Context, conn *websocket.Conn, eventID, event string, reqID int64) {
	t.Helper()
	req, err := json.Marshal(pstypes.RequestMessage{RequestId: reqID, Message: event})
	if err != nil {
		t.Fatalf("marshal RequestMessage: %v", err)
	}
	msg := pstypes.WebSocketMessage{EventId: eventID, Message: req}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := wsjson.Write(writeCtx, conn, msg); err != nil {
		t.Fatalf("wsjson.Write(%s): %v", eventID, err)
	}
}

// readResponse reads one WebSocketMessage from the server and decodes its
// Message field into a ResponseMessage.
func readResponse(t *testing.T, ctx context.Context, conn *websocket.Conn) (pstypes.WebSocketMessage, pstypes.ResponseMessage) {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var outer pstypes.WebSocketMessage
	if err := wsjson.Read(readCtx, conn, &outer); err != nil {
		t.Fatalf("wsjson.Read: %v", err)
	}
	var resp pstypes.ResponseMessage
	if err := json.Unmarshal(outer.Message, &resp); err != nil {
		t.Fatalf("unmarshal ResponseMessage from %s: %v (raw=%s)", outer.EventId, err, string(outer.Message))
	}
	return outer, resp
}

// TestWebSocketHandler_SubscribeRoundTrip exercises a full subscribe / response
// cycle over the migrated coder/websocket transport. It validates that
// wsjson.Read / wsjson.Write interoperate with the existing
// pstypes.WebSocketMessage JSON shape unchanged.
func TestWebSocketHandler_SubscribeRoundTrip(t *testing.T) {
	psh := newWSTestHub(t)
	wsURL := wsTestServer(t, psh)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn := dialWS(t, ctx, wsURL)

	const reqID int64 = 1
	sendRequest(t, ctx, conn, "subscribe", "newblock", reqID)

	outer, resp := readResponse(t, ctx, conn)
	if outer.EventId != "subscribeResp" {
		t.Errorf("EventId = %q, want %q", outer.EventId, "subscribeResp")
	}
	if !resp.Success {
		t.Errorf("Success = false, want true (Data=%q)", resp.Data)
	}
	if resp.RequestId != reqID {
		t.Errorf("RequestId = %d, want %d", resp.RequestId, reqID)
	}
	if resp.RequestEventId != "newblock" {
		t.Errorf("RequestEventId = %q, want %q", resp.RequestEventId, "newblock")
	}
}

// TestWebSocketHandler_VersionRoundTrip covers the version handshake — the
// same path psclient uses immediately after dialing. Confirms the JSON shape
// for non-subscribe responses survives the migration.
func TestWebSocketHandler_VersionRoundTrip(t *testing.T) {
	psh := newWSTestHub(t)
	wsURL := wsTestServer(t, psh)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn := dialWS(t, ctx, wsURL)

	const reqID int64 = 42
	sendRequest(t, ctx, conn, "version", "", reqID)

	outer, resp := readResponse(t, ctx, conn)
	if outer.EventId != "versionResp" {
		t.Errorf("EventId = %q, want %q", outer.EventId, "versionResp")
	}
	if !resp.Success {
		t.Errorf("Success = false, want true (Data=%q)", resp.Data)
	}
	var ver pstypes.Ver
	if err := json.Unmarshal([]byte(resp.Data), &ver); err != nil {
		t.Fatalf("unmarshal Ver: %v (data=%q)", err, resp.Data)
	}
	if ver != psh.ver {
		t.Errorf("server version = %v, want %v", ver, psh.ver)
	}
}

// TestWebSocketHandler_ConcurrentRequestsDoNotPanic fires several requests
// without waiting for responses, then drains them. The migrated handler relies
// on coder/websocket's internal write serialization — the read goroutine
// writes responses concurrently with the broadcast send goroutine. This test
// proves that path doesn't panic or deadlock for typical interactive traffic.
func TestWebSocketHandler_ConcurrentRequestsDoNotPanic(t *testing.T) {
	psh := newWSTestHub(t)
	wsURL := wsTestServer(t, psh)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn := dialWS(t, ctx, wsURL)

	const n = 8
	for i := int64(0); i < n; i++ {
		sendRequest(t, ctx, conn, "version", "", i)
	}
	for i := 0; i < n; i++ {
		outer, resp := readResponse(t, ctx, conn)
		if outer.EventId != "versionResp" || !resp.Success {
			t.Errorf("iter %d: EventId=%q success=%v data=%q", i, outer.EventId, resp.Success, resp.Data)
		}
	}
}
