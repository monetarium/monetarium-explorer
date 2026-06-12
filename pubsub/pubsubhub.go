// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package pubsub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/monetarium/monetarium-node/chaincfg"
	"github.com/monetarium/monetarium-node/dcrutil"
	chainjson "github.com/monetarium/monetarium-node/rpc/jsonrpc/types"
	"github.com/monetarium/monetarium-node/txscript/stdscript"
	"github.com/monetarium/monetarium-node/wire"

	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/blockdata"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	exptypes "github.com/monetarium/monetarium-explorer/explorer/types"
	"github.com/monetarium/monetarium-explorer/mempool"
	pstypes "github.com/monetarium/monetarium-explorer/pubsub/types"
	"github.com/monetarium/monetarium-explorer/semver"
	"github.com/monetarium/monetarium-explorer/txhelpers"
)

var version = semver.NewSemver(3, 2, 0)

// Version indicates the semantic version of the pubsub module.
func Version() semver.Semver {
	return version
}

const (
	// wsWriteTimeout bounds individual write operations. coder/websocket uses
	// context cancellation rather than SetWriteDeadline for write timeouts.
	wsWriteTimeout = 5 * time.Second
)

// DataSource defines the interface for collecting required data.
type DataSource interface {
	GetExplorerBlock(ctx context.Context, hash string) *exptypes.BlockInfo
	DecodeRawTransaction(ctx context.Context, txhex string) (*chainjson.TxRawResult, error)
	SendRawTransaction(ctx context.Context, txhex string) (string, error)
	GetChainParams() *chaincfg.Params
	BlockSubsidy(ctx context.Context, height int64, voters uint16) *chainjson.GetBlockSubsidyResult
	Difficulty(ctx context.Context, timestamp int64) float64
	Height() int64
	GetSummaryRange(ctx context.Context, idx0, idx1 int) []*apitypes.BlockDataBasic
	VARCoinSupply(ctx context.Context) (*exptypes.VARCoinSupply, error)
	SKACoinSupply(ctx context.Context) ([]*exptypes.SKACoinSupplyEntry, error)
	GetVoteTicketDataByBlock(ctx context.Context, blockHash string) ([]dbtypes.VoteTicketData, error)
	GetHeightByTimestamp(ctx context.Context, timestamp time.Time) (int64, error)
	ActiveMiners(ctx context.Context, minHeight int64) (int64, error)
}

// State represents the current state of block chain.
type State struct {
	// State is read locked by the send loop, and read/write locked when
	// occasional updates are made.
	mtx sync.RWMutex

	// GeneralInfo contains a variety of high level status information. Much of
	// GeneralInfo is constant, set in the constructor, while many fields are
	// set when Store provides new block details.
	GeneralInfo *exptypes.HomeInfo

	// BlockInfo contains details on the most recent block. It is updated when
	// Store provides new block details.
	BlockInfo *exptypes.BlockInfo

	// BlockchainInfo contains the result of the getblockchaininfo RPC. It is
	// updated when Store provides new block details.
	BlockchainInfo *chainjson.GetBlockChainInfoResult
}

type connection struct {
	sync.WaitGroup
	ws     *websocket.Conn
	client *clientHubSpoke
	// ctx is cancelled when any of the per-connection goroutines (receive,
	// send, ping) decides the connection is dead. Cancelling tears down the
	// other two so the handler can exit and the hub can unregister the client.
	ctx    context.Context
	cancel context.CancelFunc
}

// PubSubHub manages the collection and distribution of block chain and mempool
// data to WebSocket clients.
type PubSubHub struct {
	sourceBase DataSource
	wsHub      *WebsocketHub
	state      *State
	params     *chaincfg.Params
	invsMtx    sync.RWMutex
	invs       *exptypes.MempoolInfo
	ver        pstypes.Ver
}

// NewPubSubHub constructs a PubSubHub given a data source. The WebSocketHub is
// automatically started.
func NewPubSubHub(dataSource DataSource) (*PubSubHub, error) {
	psh := new(PubSubHub)
	psh.sourceBase = dataSource

	// Allocate Mempool fields.
	psh.invs = new(exptypes.MempoolInfo)

	// Retrieve chain parameters.
	params := psh.sourceBase.GetChainParams()
	psh.params = params

	sv := Version()
	psh.ver = pstypes.NewVer(sv.Split())

	psh.state = &State{
		// Set the constant parameters of GeneralInfo.
		GeneralInfo: &exptypes.HomeInfo{
			Params: exptypes.ChainParams{
				WindowSize:       params.StakeDiffWindowSize,
				RewardWindowSize: params.SubsidyReductionInterval,
				BlockTime:        params.TargetTimePerBlock.Nanoseconds(),
				MeanVotingBlocks: txhelpers.CalcMeanVotingBlocks(params),
			},
			PoolInfo: exptypes.TicketPoolInfo{
				Target: uint32(params.TicketPoolSize) * uint32(params.TicketsPerBlock),
			},
		},
		// BlockInfo and BlockchainInfo are set by Store()
	}

	psh.wsHub = NewWebsocketHub()
	go psh.wsHub.Run()

	return psh, nil
}

// StopWebsocketHub stops the websocket hub.
func (psh *PubSubHub) StopWebsocketHub() {
	if psh == nil {
		return
	}
	log.Info("Stopping websocket hub.")
	psh.wsHub.Stop()
}

// Ready checks if the WebSocketHub is ready.
func (psh *PubSubHub) Ready() bool {
	return psh.wsHub.Ready()
}

// SetReady updates the ready status of the WebSocketHub.
func (psh *PubSubHub) SetReady(ready bool) {
	psh.wsHub.SetReady(ready)
}

// HubRelay returns the channel used to signal to the WebSocketHub. See
// pstypes.HubSignal for valid signals.
func (psh *PubSubHub) HubRelay() chan pstypes.HubMessage {
	return psh.wsHub.HubRelay
}

// MempoolInventory safely retrieves the current mempool inventory.
func (psh *PubSubHub) MempoolInventory() *exptypes.MempoolInfo {
	psh.invsMtx.RLock()
	defer psh.invsMtx.RUnlock()
	return psh.invs
}

// closeWS attempts a graceful close of a websocket.Conn, logging unexpected
// errors. Repeated closes are silently ignored.
func closeWS(ws *websocket.Conn) {
	err := ws.Close(websocket.StatusNormalClosure, "")
	if err != nil && !pstypes.IsWSClosedErr(err) && !pstypes.IsIOTimeoutErr(err) {
		log.Errorf("Failed to close websocket: %v", err)
	}
}

// receiveLoop receives and processes incoming messages from active websocket
// connections. receiveLoop should be started as a goroutine, after conn.Add(1)
// and before a conn.Wait(). receiveLoop returns when the websocket connection,
// conn.ws, is closed, which should be initiated when sendLoop returns or when
// the ping goroutine cancels conn.ctx after a missed pong.
func (psh *PubSubHub) receiveLoop(ctx context.Context, conn *connection) {
	//defer conn.client.cl.unsubscribeAll()

	// receiveLoop should be started after conn.Add(1) and before a conn.Wait().
	defer conn.Done()
	// Tear down the rest of the per-connection goroutines on exit.
	defer conn.cancel()

	// Receive messages on the websocket.Conn until it is closed.
	ws := conn.ws
	for {
		// Wait to receive a message on the websocket. Liveness is enforced by
		// the ping goroutine (RFC 6455 ping/pong), not a per-read deadline.
		msg := new(pstypes.WebSocketMessage)
		err := wsjson.Read(conn.ctx, ws, msg)
		if err != nil {
			if !pstypes.IsWSClosedErr(err) {
				log.Warnf("websocket client receive error: %v", err)
			}
			return
		}

		// Handle the received message according to its event ID.
		resp := pstypes.WebSocketMessage{
			EventId: msg.EventId + "Resp",
		}

		// Reject messages that exceed the limit.
		if len(msg.Message) > psh.wsHub.requestLimit {
			log.Debug("Request size over limit")
			resp.Message = json.RawMessage(`"Request too large"`) // skip json.Marshal for a string.
			continue
		}

		var req pstypes.RequestMessage
		err = json.Unmarshal(msg.Message, &req)
		if err != nil {
			log.Debugf("Unmarshal: %v", err)
			continue
		}
		reqEvent := req.Message

		// Create the ResponseMessage that is marshalled into resp.Message.
		respMsg := pstypes.ResponseMessage{
			RequestEventId: req.Message,
			RequestId:      req.RequestId, // associate the response with the client's request ID
		}

		// Determine response based on EventId and Message content.
		switch msg.EventId {
		case "subscribe":
			sig, sigMsg, valid := pstypes.ValidateSubscription(reqEvent)
			if !valid {
				log.Debugf("Invalid subscribe signal: %.40s...", reqEvent)
				respMsg.Data = "error: invalid subscription"
				break
			}

			var ok bool
			ok, err = conn.client.cl.subscribe(pstypes.HubMessage{Signal: sig, Msg: sigMsg})
			if err != nil {
				log.Debugf("Failed to subscribe: %.40s...", reqEvent)
				respMsg.Data = "error: " + err.Error()
				break
			}
			if !ok && sig != sigPingAndUserCount { // don't error on users over the legacy ping subscription request
				log.Debugf("Client CANNOT subscribe to: %v.", reqEvent)
				respMsg.Data = "cannot subscribed to " + reqEvent
				break
			}

			if sig != sigPingAndUserCount {
				log.Debugf("Client subscribed for: %v.", reqEvent)
				// Do not error on old clients that try to subscribe to ping
				// since they will get pings automatically.
			}
			respMsg.Data = "subscribed to " + reqEvent
			respMsg.Success = true

		case "unsubscribe":
			sig, sigMsg, valid := pstypes.ValidateSubscription(reqEvent)
			if !valid {
				log.Debugf("Invalid unsubscribe signal: %.40s...", reqEvent)
				respMsg.Data = "error: invalid subscription"
				break
			}

			err = conn.client.cl.unsubscribe(pstypes.HubMessage{Signal: sig, Msg: sigMsg})
			if err != nil {
				log.Debugf("Failed to unsubscribe from: %.40s...", reqEvent)
				respMsg.Data = "error: " + err.Error()
				break
			}

			log.Debugf("Client unsubscribed from: %v.", reqEvent)
			respMsg.Data = "unsubscribed from " + reqEvent
			respMsg.Success = true

		case "decodetx":
			log.Debugf("Received decodetx signal for hex: %.40s...", reqEvent)
			tx, err := psh.sourceBase.DecodeRawTransaction(ctx, reqEvent)
			if err == nil {
				var decoded []byte
				decoded, err = json.MarshalIndent(tx, "", "    ")
				if err != nil {
					log.Warn("Invalid JSON message: ", err)
					respMsg.Data = "error: Could not encode JSON message"
					break
				}
				respMsg.Success = true
				respMsg.Data = string(decoded)
			} else {
				log.Debugf("Could not decode raw tx: %v", err)
				respMsg.Data = fmt.Sprintf("error: %v", err)
			}

		case "sendtx":
			log.Debugf("Received sendtx signal for hex: %.40s...", reqEvent)
			txid, err := psh.sourceBase.SendRawTransaction(ctx, reqEvent)
			if err != nil {
				respMsg.Data = fmt.Sprintf("error: %v", err)
			} else {
				respMsg.Success = true
				respMsg.Data = txid
			}

		case "getmempooltxs": // TODO: maybe disable this case
			// construct mempool object with properties required in template
			inv := psh.MempoolInventory()

			psh.state.mtx.RLock()
			maxBlockSize := float64(psh.state.BlockchainInfo.MaxBlockSize)
			subsidy := psh.state.GeneralInfo.NBlockSubsidy
			psh.state.mtx.RUnlock()

			mempoolInfo := inv.Trim(maxBlockSize) // Trim locks the inventory.
			mempoolInfo.Subsidy = subsidy

			var b []byte
			b, err = json.Marshal(mempoolInfo)
			if err != nil {
				log.Warn("Invalid JSON message: ", err)
				respMsg.Data = "error: Could not encode JSON message"
				break
			}
			respMsg.Data = string(b)
			respMsg.Success = true

		case "version":
			var b []byte
			b, err = json.Marshal(psh.ver)
			if err != nil {
				log.Warn("Invalid JSON message: ", err)
				respMsg.Data = "error: Could not encode JSON message"
				break
			}
			respMsg.Data = string(b)
			respMsg.Success = true

		case "ping":
			log.Tracef("We've been pinged!")
			// No response to ping
			continue

		default:
			log.Warnf("Unrecognized event ID: %v", reqEvent)
			// ignore unrecognized events
			continue
		}

		// Marshal the ResponseMessage into the RawJSON type field, Message, of
		// the WebSocketMessage.
		resp.Message, err = json.Marshal(respMsg)
		if err != nil {
			log.Warnf("Failed to Marshal subscribe response for %s: %v", reqEvent, err)
			continue
		}

		// Send the response with a bounded write timeout.
		writeCtx, writeCancel := context.WithTimeout(conn.ctx, wsWriteTimeout)
		err = wsjson.Write(writeCtx, ws, resp)
		writeCancel()
		if err != nil {
			if !pstypes.IsWSClosedErr(err) {
				log.Debugf("Failed to encode WebSocketMessage (reply) %s: %v",
					resp.EventId, err)
			}
			// If the send failed, the client is probably gone, quit the
			// receive loop, closing the websocket.Conn.
			return
		}
	} // for {
}

// sendLoop receives signals from WebSocketHub via the connections unique signal
// channel, and sends the relevant data to the client. sendLoop will return when
// conn.client.c is closed. On return, the websocket connection, conn.ws, will
// be closed, thus forcing the same connection's receiveLoop to return.
func (psh *PubSubHub) sendLoop(conn *connection) {
	// Use this client's unique channel to receive signals from the
	// WebSocketHub, which broadcasts signals to all clients.
	updateSigChan := *conn.client.c
	clientData := conn.client.cl
	buff := new(bytes.Buffer)

	// sendLoop should be started after conn.Add(1), and before a conn.Wait().
	defer conn.Done()
	// Tear down sibling goroutines (receive, ping) on exit.
	defer conn.cancel()

	// If returning because the WebSocketHub sent a quit signal, the receive
	// loop may still be waiting for a message, so it is necessary to close the
	// websocket.Conn in this case.
	ws := conn.ws
	defer closeWS(ws)

loop:
	for sig := range updateSigChan {
		log.Tracef("(*PubSubHub)sendLoop: updateSigChan received %v for client %d",
			sig, clientData.id)
		// If the update channel is closed, the loop terminates.

		if !sig.IsValid() {
			log.Errorf("invalid signal to send: %s / %d", sig.Signal, int(sig.Signal))
			continue loop
		}

		switch sig.Signal {
		case sigByeNow, sigPingAndUserCount:
			// These signals are not subscription-based.
		default:
			if !clientData.isSubscribed(sig) {
				log.Errorf("Client not subscribed for %s events. "+
					"WebSocketHub should have caught this.", sig)
				continue loop // break
			}
		}

		log.Tracef("signaling client %d with %s", clientData.id, sig)

		// Respond to the websocket client.
		pushMsg := pstypes.WebSocketMessage{
			EventId: sig.Signal.String(),
			// Message is set in switch statement below.
		}

		// JSON encoder for the Message.
		buff.Reset()
		enc := json.NewEncoder(buff)

		switch sig.Signal {
		case sigAddressTx:
			// sig was already validated, but do it again here in case the
			// type changed without changing the type assertion here.
			am, ok := sig.Msg.(*pstypes.AddressMessage)
			if !ok {
				log.Errorf("sigAddressTx did not store a *AddressMessage in Msg.")
				continue loop
			}
			err := enc.Encode(am)
			if err != nil {
				log.Warnf("Encode(AddressMessage) failed: %v", err)
			}

			log.Debugf("Sending sigAddressTx to client %d: %s", clientData.id, am)

			pushMsg.Message = buff.Bytes()
		case sigNewBlock:
			psh.state.mtx.RLock()
			if psh.state.BlockInfo == nil {
				psh.state.mtx.RUnlock()
				break // from switch to send empty message
			}
			err := enc.Encode(exptypes.WebsocketBlock{
				Block: psh.state.BlockInfo,
				Extra: psh.state.GeneralInfo,
			})
			psh.state.mtx.RUnlock()
			if err != nil {
				log.Warnf("Encode(WebsocketBlock) failed: %v", err)
			}

			pushMsg.Message = buff.Bytes()

		case sigMempoolUpdate:
			// You probably want the sigNewTxs event. sigMempoolUpdate sends
			// a summary of mempool contents, and the NumLatestMempoolTxns
			// latest transactions.
			inv := psh.MempoolInventory()
			if inv == nil {
				break // from switch to send empty message
			}
			inv.RLock()
			err := enc.Encode(inv.MempoolShort)
			inv.RUnlock()
			if err != nil {
				log.Warnf("Encode(MempoolShort) failed: %v", err)
			}

			pushMsg.Message = buff.Bytes()

		case sigPingAndUserCount:
			// ping and send user count
			pushMsg.Message = json.RawMessage(strconv.Itoa(psh.wsHub.NumClients())) // No quotes as this is a JSON integer

		case sigNewTxs:
			// Marshal this client's tx buffer if it is not empty.
			clientData.newTxs.Lock()
			if len(clientData.newTxs.t) == 0 {
				clientData.newTxs.Unlock()
				continue loop // break sigselect
			}
			txSlice := clientData.newTxs.t
			// Reinit the tx buffer.
			clientData.newTxs.t = make(pstypes.TxList, 0, NewTxBufferSize)
			clientData.newTxs.Unlock()

			// Attach current fill data so the client can update indicators
			// immediately without waiting for the next mempool event.
			inv := psh.MempoolInventory()
			inv.RLock()
			newTxsPayload := struct {
				Txs            pstypes.TxList                      `json:"txs"`
				CoinFills      []exptypes.CoinFillData             `json:"coin_fills"`
				TotalFillRatio float64                             `json:"total_fill_ratio"`
				ActiveSKACount int                                 `json:"active_ska_count"`
				CoinStats      map[uint8]exptypes.MempoolCoinStats `json:"coin_stats"`
			}{
				Txs:            txSlice,
				CoinFills:      inv.MempoolShort.CoinFills,
				TotalFillRatio: inv.MempoolShort.TotalFillRatio,
				ActiveSKACount: inv.MempoolShort.ActiveSKACount,
				CoinStats:      inv.MempoolShort.CoinStats,
			}
			inv.RUnlock()

			err := enc.Encode(newTxsPayload)
			if err != nil {
				log.Warnf("Encode(newTxsPayload) failed: %v", err)
			}

			pushMsg.Message = buff.Bytes()

		case sigByeNow:
			pushMsg.Message = []byte(`"The monetarium-explorer server is shutting down. Bye!"`)
			log.Tracef("Sending %v", string(pushMsg.Message))

		// case sigSyncStatus:
		// 	err := enc.Encode(explorer.SyncStatus())
		// 	if err != nil {
		// 		log.Warnf("Encode(SyncStatus()) failed: %v", err)
		// 	}
		// 	pushMsg.Message = buff.String()

		default:
			log.Errorf("Not sending a %v to the client.", sig)
			continue loop // break sigselect
		} // switch sig

		// Send the message with a bounded write timeout.
		writeCtx, writeCancel := context.WithTimeout(conn.ctx, wsWriteTimeout)
		err := wsjson.Write(writeCtx, ws, pushMsg)
		writeCancel()
		if err != nil {
			if !pstypes.IsWSClosedErr(err) {
				log.Debugf("Failed to send WebSocketMessage (push) %v: %v", sig, err)
				log.Errorf("wsjson.Write of %v type message failed: %v", sig, err)
			}
			// If the send failed, the client is probably gone, quit the
			// send loop, unregistering the client from the websocket hub.
			return
		}
	} // for range { a.k.a. loop:
}

// WebSocketHandler is the http.HandlerFunc for new websocket connections. The
// connection is registered with the WebSocketHub, and the send/receive/ping
// loops are launched.
func (psh *PubSubHub) WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	// Register websocket client.
	ch := psh.wsHub.NewClientHubSpoke()
	defer close(ch.cl.killed)

	// OriginPatterns "*" preserves the previous open-origin behavior of
	// websocket.Server{Handler: ...}. The block explorer is a public,
	// read-only feed; tightening this is a separate decision.
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Warnf("websocket.Accept failed: %v", err)
		return
	}
	// CloseNow is the panic/early-return safety net; the normal exit path
	// closes the connection with StatusNormalClosure via closeWS in sendLoop.
	defer ws.CloseNow()

	// Set the max payload size for this connection. coder/websocket defaults
	// to 32 KiB; we need the same 1 MiB cap the hub enforces.
	ws.SetReadLimit(int64(psh.wsHub.requestLimit))

	// connCtx is shared by all three per-connection goroutines. The first one
	// to detect a dead connection cancels it, tearing down the other two.
	connCtx, cancel := context.WithCancel(r.Context())
	defer cancel()

	conn := &connection{
		client: ch,
		ws:     ws,
		ctx:    connCtx,
		cancel: cancel,
	}

	// Start listening for websocket messages from the client.
	conn.Add(1)
	go psh.receiveLoop(r.Context(), conn)

	// Send loop (new tx, block, etc. update loop). sendLoop returns when the
	// client's signaling channel, conn.ch.cl.c, is closed.
	conn.Add(1)
	go psh.sendLoop(conn)

	// Ping loop: RFC 6455 keepalive. On missed pong it cancels conn.ctx,
	// which unblocks the read loop and triggers full connection teardown.
	go psh.pingLoop(conn)

	// Hang out until the send and receive loops have quit.
	conn.Wait()

	// Clean up the client's subscriptions.
	ch.cl.unsubscribeAll()
}

// pingLoop sends an RFC 6455 ping every PingInterval and aborts the connection
// if the pong does not arrive within wsWriteTimeout. This is the keepalive
// mechanism that x/net/websocket lacked: it detects zombie clients (e.g. an
// iOS Safari tab whose TCP connection has silently died) so the server can
// close the socket and let the JS reconnect take over.
func (psh *PubSubHub) pingLoop(conn *connection) {
	ticker := time.NewTicker(PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-conn.ctx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(conn.ctx, wsWriteTimeout)
			err := conn.ws.Ping(pingCtx)
			cancel()
			if err != nil {
				if !pstypes.IsWSClosedErr(err) {
					log.Debugf("websocket ping failed: %v", err)
				}
				conn.cancel()
				return
			}
		}
	}
}

// StoreMPData stores mempool data. It is advisable to pass a copy of the
// []exptypes.MempoolTx so that it may be modified (e.g. sorted) without
// affecting other MempoolDataSavers. The struct pointed to may be shared, so it
// should not be modified.
func (psh *PubSubHub) StoreMPData(_ *mempool.StakeData, _ []exptypes.MempoolTx, inv *exptypes.MempoolInfo) {
	// Get exclusive access to the Mempool field.
	psh.invsMtx.Lock()
	psh.invs = inv
	psh.invsMtx.Unlock()
	log.Debugf("Updated mempool details for the pubsubhub.")
}

// Store processes and stores new block data, then signals to the WebSocketHub
// that the new data is available.
func (psh *PubSubHub) Store(blockData *blockdata.BlockData, msgBlock *wire.MsgBlock) error {
	ctx := context.TODO()

	// Retrieve block data for the passed block hash.
	newBlockData := psh.sourceBase.GetExplorerBlock(ctx, msgBlock.BlockHash().String())

	// Use the latest block's blocktime to get the last 24hr timestamp.
	day := 24 * time.Hour
	targetTimePerBlock := float64(psh.params.TargetTimePerBlock)

	// Hashrate change over last day
	timestamp := newBlockData.BlockTime.T.Add(-day).Unix()
	last24hrDifficulty := psh.sourceBase.Difficulty(ctx, timestamp)
	last24HrHashRate := dbtypes.CalculateHashRate(last24hrDifficulty, targetTimePerBlock)

	// Hashrate change over last month
	timestamp = newBlockData.BlockTime.T.Add(-30 * day).Unix()
	lastMonthDifficulty := psh.sourceBase.Difficulty(ctx, timestamp)
	lastMonthHashRate := dbtypes.CalculateHashRate(lastMonthDifficulty, targetTimePerBlock)

	difficulty := blockData.Header.Difficulty
	hashrate := dbtypes.CalculateHashRate(difficulty, targetTimePerBlock)

	// Active miner count within a week-lookback window — query BEFORE
	// locking so WS readers aren't blocked by DB round-trips.
	var activeMinersCount int64
	var activeMinersOK bool
	{
		minHeight := int64(0)
		lookback := newBlockData.BlockTime.T.Add(-7 * 24 * time.Hour)
		if h, err := psh.sourceBase.GetHeightByTimestamp(ctx, lookback); err != nil {
			log.Warnf("Failed to query active miner count height: %v", err)
		} else {
			minHeight = h
		}
		if count, err := psh.sourceBase.ActiveMiners(ctx, minHeight); err == nil {
			activeMinersCount = count
			activeMinersOK = true
		}
	}

	// If BlockData contains non-nil PoolInfo, compute actual percentage of DCR
	// supply staked.
	stakePerc := 45.0
	if blockData.PoolInfo != nil {
		stakePerc = blockData.PoolInfo.Value / dcrutil.Amount(blockData.ExtraInfo.CoinSupply).ToCoin()
	}

	// Update pageData with block data and chain (home) info.
	p := psh.state
	p.mtx.Lock()

	// Store current block and blockchain data.
	p.BlockInfo = newBlockData
	p.BlockchainInfo = blockData.BlockchainInfo

	// Update GeneralInfo, keeping constant parameters set in NewPubSubHub.
	p.GeneralInfo.HashRate = hashrate
	p.GeneralInfo.HashRateChangeDay = 100 * (hashrate - last24HrHashRate) / last24HrHashRate
	p.GeneralInfo.HashRateChangeMonth = 100 * (hashrate - lastMonthHashRate) / lastMonthHashRate
	p.GeneralInfo.CoinSupply = blockData.ExtraInfo.CoinSupply
	p.GeneralInfo.StakeDiff = blockData.CurrentStakeDiff.CurrentStakeDifficulty
	p.GeneralInfo.NextExpectedStakeDiff = blockData.EstStakeDiff.Expected
	p.GeneralInfo.NextExpectedBoundsMin = blockData.EstStakeDiff.Min
	p.GeneralInfo.NextExpectedBoundsMax = blockData.EstStakeDiff.Max
	p.GeneralInfo.IdxBlockInWindow = blockData.IdxBlockInWindow
	p.GeneralInfo.IdxInRewardWindow = int(newBlockData.Height%psh.params.SubsidyReductionInterval) + 1
	p.GeneralInfo.Difficulty = difficulty
	p.GeneralInfo.NBlockSubsidy.Dev = blockData.ExtraInfo.NextBlockSubsidy.Developer
	p.GeneralInfo.NBlockSubsidy.PoS = blockData.ExtraInfo.NextBlockSubsidy.PoS
	p.GeneralInfo.NBlockSubsidy.PoW = blockData.ExtraInfo.NextBlockSubsidy.PoW
	p.GeneralInfo.NBlockSubsidy.Total = blockData.ExtraInfo.NextBlockSubsidy.Total
	if blockData.ExtraInfo.CurrentBlockSubsidy != nil {
		p.GeneralInfo.CBlockSubsidy.Dev = blockData.ExtraInfo.CurrentBlockSubsidy.Developer
		p.GeneralInfo.CBlockSubsidy.PoS = blockData.ExtraInfo.CurrentBlockSubsidy.PoS
		p.GeneralInfo.CBlockSubsidy.PoW = blockData.ExtraInfo.CurrentBlockSubsidy.PoW
		p.GeneralInfo.CBlockSubsidy.Total = blockData.ExtraInfo.CurrentBlockSubsidy.Total
	} else {
		p.GeneralInfo.CBlockSubsidy = p.GeneralInfo.NBlockSubsidy
	}
	if activeMinersOK {
		p.GeneralInfo.ActiveMiners = activeMinersCount
	}

	// Total reward = subsidy + mining fees (~16 + <1 VAR)
	// MiningFee from blockData (computed in collector)
	p.GeneralInfo.MiningFeeAtoms = blockData.ExtraInfo.MiningFeeAtoms
	p.GeneralInfo.LBlockTotal = dcrutil.Amount(p.GeneralInfo.CBlockSubsidy.PoW).ToCoin() + dcrutil.Amount(blockData.ExtraInfo.MiningFeeAtoms).ToCoin()
	p.GeneralInfo.LBlockTotalAtoms = p.GeneralInfo.CBlockSubsidy.PoW + blockData.ExtraInfo.MiningFeeAtoms
	log.Debugf("PUB LBlockTotalAtoms: %d (MiningFee: %.8f, CBlockSubsidy.PoW: %d)", p.GeneralInfo.LBlockTotalAtoms, dcrutil.Amount(blockData.ExtraInfo.MiningFeeAtoms).ToCoin(), p.GeneralInfo.CBlockSubsidy.PoW)

	// If BlockData contains non-nil PoolInfo, copy values.
	p.GeneralInfo.PoolInfo = exptypes.TicketPoolInfo{}
	if blockData.PoolInfo != nil {
		tpTarget := uint32(psh.params.TicketPoolSize) * uint32(psh.params.TicketsPerBlock)
		p.GeneralInfo.PoolInfo = exptypes.TicketPoolInfo{
			Size:          blockData.PoolInfo.Size,
			Value:         blockData.PoolInfo.Value,
			ValAvg:        blockData.PoolInfo.ValAvg,
			Percentage:    stakePerc * 100,
			PercentTarget: 100 * float64(blockData.PoolInfo.Size) / float64(tpTarget),
			Target:        tpTarget,
		}
	}

	// Compute 30-day history for fee and reward averages
	tip := int(psh.sourceBase.Height())
	blocksIn30Days := int(30 * 24 * time.Hour / psh.params.TargetTimePerBlock)
	start30 := tip - blocksIn30Days
	if start30 < 0 {
		start30 = 0
	}
	sum30Raw := psh.sourceBase.GetSummaryRange(ctx, start30, tip)
	sum30 := make([]txhelpers.BlockSummary, len(sum30Raw))
	for i, s := range sum30Raw {
		sum30[i] = txhelpers.BlockSummary{
			SSFeeTotalsByCoin: s.SSFeeTotalsByCoin,
			Voters:            s.Voters,
			Hash:              s.Hash,
			Height:            int(s.Height),
		}
	}

	// Calculate Vote VAR Reward (most recent)
	// Compute fresh from the current block's transactions instead of using potentially stale DB data
	ssFeeTotals := txhelpers.BlockSSFeeTotals(msgBlock.STransactions)

	var latestVarFee float64
	if split, ok := ssFeeTotals[0]; ok {
		latestVarFee = txhelpers.RewardAtomsToCoins(split.PoS, 8)
	}

	voteData, err := psh.sourceBase.GetVoteTicketDataByBlock(ctx, blockData.Header.Hash)
	var txVoteData []txhelpers.VoteTicketData
	if err == nil {
		txVoteData = make([]txhelpers.VoteTicketData, len(voteData))
		for i, vd := range voteData {
			txVoteData[i] = txhelpers.VoteTicketData{
				TicketPrice:    vd.TicketPrice,
				VoteHeight:     vd.VoteHeight,
				PurchaseHeight: vd.PurchaseHeight,
			}
		}
	}

	posSubsidy := 0.0
	if blockData.ExtraInfo.CurrentBlockSubsidy != nil {
		posSubsidy = float64(blockData.ExtraInfo.CurrentBlockSubsidy.PoS) / 1e8
	}

	res := txhelpers.ComputeVoteVARReward(latestVarFee, txVoteData, psh.params, int64(blockData.Header.Voters), posSubsidy)

	p.GeneralInfo.VoteVARReward = exptypes.VoteVARReward{
		PerBlock: res.PerBlock,
		Subsidy:  res.Subsidy,
		Fee:      res.Fee,
		ROI:      res.ROI,
	}

	// The actual reward of a ticket needs to also take into consideration the
	// ticket maturity (time from ticket purchase until its eligible to vote)
	// and coinbase maturity (time after vote until funds distributed to ticket
	// holder are available to use).
	avgSSTxToSSGenMaturity := psh.state.GeneralInfo.Params.MeanVotingBlocks +
		int64(psh.params.TicketMaturity) +
		int64(psh.params.CoinbaseMaturity)
	p.GeneralInfo.RewardPeriod = fmt.Sprintf("%.2f days", float64(avgSSTxToSSGenMaturity)*
		psh.params.TargetTimePerBlock.Hours()/24)

	// Compute per-SKA vote rewards. PerBlock is retrieved from the latest block
	// that contains SKA fee data.
	// tip, blocksIn30Days, start30, sum30 are already computed above.
	// blocksPerYear is already computed in the Vote VAR Reward section.

	coinTypes := make(map[uint8]struct{})
	for ct, split := range blockData.ExtraInfo.SSFeeTotalsByCoin {
		if split.PoS != nil {
			coinTypes[ct] = struct{}{}
		}
	}
	for _, s := range sum30 {
		for ct := range s.SSFeeTotalsByCoin {
			coinTypes[ct] = struct{}{}
		}
	}

	if len(coinTypes) > 0 {
		rewards := make([]exptypes.SKAVoteReward, 0, len(coinTypes))
		for ct := range coinTypes {
			var perBlock string
			var blockHeight int64
			var blockHash string

			// Find the latest block specifically for this coin type
			if split, ok := blockData.ExtraInfo.SSFeeTotalsByCoin[ct]; ok && split.PoS != nil {
				if int64(blockData.Header.Voters) > 0 {
					perVote := new(big.Int).Div(split.PoS, big.NewInt(int64(blockData.Header.Voters)))
					perBlock = txhelpers.FormatSKAAtoms(perVote)
					blockHeight = int64(blockData.Header.Height)
					blockHash = blockData.Header.Hash
				}
			}

			if perBlock == "" {
				// Fallback: Search backwards through historical summaries for this coin
				for i := len(sum30) - 1; i >= 0; i-- {
					if split, ok := sum30[i].SSFeeTotalsByCoin[ct]; ok && split.PoS != nil {
						bInfo := psh.sourceBase.GetExplorerBlock(ctx, sum30[i].Hash)
						if bInfo != nil && bInfo.BlockBasic.Voters > 0 {
							perVote := new(big.Int).Div(split.PoS, big.NewInt(int64(bInfo.BlockBasic.Voters)))
							perBlock = txhelpers.FormatSKAAtoms(perVote)
							blockHeight = int64(sum30[i].Height)
							blockHash = sum30[i].Hash
							break
						}
					}
				}
			}

			perYear := "0.000000000000000000"
			if blockHash != "" {
				voteData, err := psh.sourceBase.GetVoteTicketDataByBlock(ctx, blockHash)
				if err == nil && len(voteData) > 0 {
					var totalReward *big.Int
					if split, ok := blockData.ExtraInfo.SSFeeTotalsByCoin[ct]; ok && split.PoS != nil {
						totalReward = split.PoS
					} else {
						for _, s := range sum30 {
							if int64(s.Height) == blockHeight {
								if split, ok := s.SSFeeTotalsByCoin[ct]; ok && split.PoS != nil {
									totalReward = split.PoS
								}
								break
							}
						}
					}

					if totalReward != nil {
						blocksPerYear := 365 * 24 * time.Hour / psh.params.TargetTimePerBlock
						blocksPerYearBF := new(big.Float).SetPrec(256).SetInt64(int64(blocksPerYear))
						// rewardPerTicket is the reward for a single ticket slot.
						// We divide by TicketsPerBlock (fixed at 5) because the total reward
						// is distributed across all possible voting slots in the block,
						// regardless of whether every slot was filled.
						rewardPerTicket := new(big.Float).SetPrec(256).SetInt(totalReward)
						rewardPerTicket.Quo(rewardPerTicket, new(big.Float).SetPrec(256).SetInt64(1_000_000_000_000_000_000))
						rewardPerTicket.Quo(rewardPerTicket, new(big.Float).SetPrec(256).SetInt64(int64(psh.params.TicketsPerBlock)))

						tickets := make([]txhelpers.VoteTicketData, len(voteData))
						for i, vd := range voteData {
							tickets[i] = txhelpers.VoteTicketData{
								TicketPrice:    vd.TicketPrice,
								VoteHeight:     vd.VoteHeight,
								PurchaseHeight: vd.PurchaseHeight,
							}
						}
						perYear = txhelpers.CalculateAverageTicketAPY(tickets, rewardPerTicket, blocksPerYearBF)
					}
				}
			}

			rewards = append(rewards, exptypes.SKAVoteReward{
				CoinType:    ct,
				Symbol:      fmt.Sprintf("SKA%d", ct),
				PerBlock:    perBlock,
				PerYear:     perYear,
				BlockHeight: blockHeight,
			})
		}
		sort.Slice(rewards, func(i, j int) bool { return rewards[i].CoinType < rewards[j].CoinType })
		p.GeneralInfo.SKAVoteRewards = rewards
	} else {
		p.GeneralInfo.SKAVoteRewards = nil
	}

	// PoW SKA Fee Reward: the miner's portion of redistributed SKA tx fees
	// from the authoritative "MF"-marked SSFee split (issue #273). Mirrors the
	// explorer (HTTP) derivation so the two paths cannot drift.
	powRewardsBlockHeight := make(map[uint8]int64)
	powRewards := make([]exptypes.PoWSKAReward, 0)
	for ct, split := range blockData.ExtraInfo.SSFeeTotalsByCoin {
		if ct == 0 || split.PoW == nil || split.PoW.Sign() <= 0 {
			continue
		}
		powRewardsBlockHeight[ct] = int64(blockData.Header.Height)
		powRewards = append(powRewards, exptypes.PoWSKAReward{
			CoinType:    ct,
			Symbol:      fmt.Sprintf("SKA%d", ct),
			Amount:      txhelpers.FormatSKAAtoms(split.PoW),
			BlockHeight: powRewardsBlockHeight[ct],
		})
	}
	if len(powRewards) > 0 {
		sort.Slice(powRewards, func(i, j int) bool { return powRewards[i].CoinType < powRewards[j].CoinType })
		p.GeneralInfo.PoWSKARewards = powRewards
	} else {
		p.GeneralInfo.PoWSKARewards = nil
	}

	// Coin supply data for the Supply section.
	if varSupply, err := psh.sourceBase.VARCoinSupply(ctx); err != nil {
		log.Errorf("Store: VARCoinSupply failed: %v", err)
	} else {
		p.GeneralInfo.VARCoinSupply = varSupply
	}
	if skaSupply, err := psh.sourceBase.SKACoinSupply(ctx); err != nil {
		log.Errorf("Store: SKACoinSupply failed: %v", err)
	} else {
		entries := make([]exptypes.SKACoinSupplyEntry, len(skaSupply))
		for i, e := range skaSupply {
			entries[i] = *e
		}
		p.GeneralInfo.SKACoinSupply = entries
	}

	p.mtx.Unlock()

	// Signal to the websocket hub that a new block was received, but do not
	// block Store(), and do not hang forever in a goroutine waiting to send.
	go func() {
		select {
		case psh.wsHub.HubRelay <- pstypes.HubMessage{Signal: sigNewBlock}:
		case <-time.After(time.Second * 10):
			log.Errorf("sigNewBlock send failed: Timeout waiting for WebsocketHub.")
		}
	}()

	// Broadcast updated fill bars so clients learn about newly issued coins
	// (e.g. via coinbase) even before they arrive.
	go func() {
		select {
		case psh.wsHub.HubRelay <- pstypes.HubMessage{Signal: sigMempoolUpdate}:
		case <-time.After(time.Second * 10):
			log.Errorf("sigMempoolUpdate send failed: Timeout waiting for WebsocketHub.")
		}
	}()

	log.Debugf("Got new block %d for the pubsubhub.", newBlockData.Height)

	// Since the coinbase transaction is generated by the miner, it will never
	// hit mempool. It must be processed now, with the new block.
	coinbaseTx := msgBlock.Transactions[0]
	coinbaseHash := coinbaseTx.CachedTxHash().String() // data race with other Storers?
	// Check each output's pkScript for subscribed addresses.
	for _, out := range coinbaseTx.TxOut {
		_, scriptAddrs := stdscript.ExtractAddrs(out.Version, out.PkScript, psh.params)
		for _, scriptAddr := range scriptAddrs {
			addr := scriptAddr.String()
			go func() {
				select {
				case psh.wsHub.HubRelay <- pstypes.HubMessage{
					Signal: sigAddressTx,
					Msg: &pstypes.AddressMessage{
						Address: addr,
						TxHash:  coinbaseHash,
					},
				}:
				case <-time.After(time.Second * 10):
					log.Errorf("sigNewBlock send failed: Timeout waiting for WebsocketHub.")
				}
			}()
		}
	}

	// The coinbase transaction is also sent in a new transaction signal to
	// pubsub clients. It's not really mempool.
	newTxCoinbase := exptypes.MempoolTx{
		TxID:    coinbaseHash,
		Version: int32(coinbaseTx.Version),
		// Fees are 0
		VinCount:  len(coinbaseTx.TxIn),
		VoutCount: len(coinbaseTx.TxOut),
		Vin:       exptypes.MsgTxMempoolInputs(coinbaseTx),
		Coinbase:  true,
		Hash:      coinbaseHash,
		Time:      blockData.Header.Time,
		Size:      int32(coinbaseTx.SerializeSize()),
		TotalOut:  txhelpers.TotalOutFromMsgTx(coinbaseTx).ToCoin(),
		Type:      txhelpers.TxTypeToString(0), // "Regular"
		TypeID:    0,                           // stake.TxTypeRegular
	}

	go func() {
		select {
		case psh.wsHub.HubRelay <- pstypes.HubMessage{
			Signal: sigNewTx,
			Msg:    &newTxCoinbase,
		}:
		case <-time.After(time.Second * 10):
			log.Errorf("sigNewTx send failed: Timeout waiting for WebsocketHub.")
		}
	}()

	return nil
}
