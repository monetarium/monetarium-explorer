// Copyright (c) 2018-2021, The Decred developers
// Copyright (c) 2017, The dcrdata developers
// See LICENSE for details.

package explorer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	apitypes "github.com/monetarium/monetarium-explorer/api/types"
	"github.com/monetarium/monetarium-explorer/db/dbtypes"
	"github.com/monetarium/monetarium-explorer/explorer/types"
	pstypes "github.com/monetarium/monetarium-explorer/pubsub/types"
)

// RootWebsocket is the websocket handler for all pages
func (exp *explorerUI) RootWebsocket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Create channel to signal updated data availability
	updateSig := make(hubSpoke, 3)
	// Create a channel for exchange updates
	xcChan := make(exchangeChannel, 3)
	// register websocket client with our signal channel
	clientData := exp.wsHub.RegisterClient(&updateSig, xcChan)
	// unregister (and close signal channel) before return
	defer exp.wsHub.UnregisterClient(&updateSig)

	// OriginPatterns "*" preserves the previous open-origin behavior of
	// websocket.Handler. The block explorer is a public, read-only feed;
	// tightening this is a separate decision.
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		log.Warnf("websocket.Accept failed: %v", err)
		return
	}
	defer ws.CloseNow()

	const requestLimit = 1 << 20
	// coder/websocket defaults to 32 KiB; raise to match the prior 1 MiB cap.
	ws.SetReadLimit(int64(requestLimit))

	// connCtx is cancelled by any of the three per-connection goroutines
	// (reader, signal-loop, ping) when they decide the connection is dead.
	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// close the websocket
	closeWS := func() {
		err := ws.Close(websocket.StatusNormalClosure, "")
		// Do not log error if connection is just closed.
		if err != nil && !pstypes.IsWSClosedErr(err) &&
			!pstypes.IsIOTimeoutErr(err) {
			log.Errorf("Failed to close websocket: %v", err)
		}
	}
	defer closeWS()

	send := func(webData WebSocketMessage) error {
		writeCtx, writeCancel := context.WithTimeout(connCtx, wsWriteTimeout)
		defer writeCancel()
		if err := wsjson.Write(writeCtx, ws, webData); err != nil {
			// Do not log error if connection is just closed
			if !pstypes.IsWSClosedErr(err) {
				log.Debugf("Failed to send web socket message %s: %v", webData.EventId, err)
			}
			// If the send failed, the client is probably gone, so close
			// the connection and quit.
			return fmt.Errorf("send fail")
		}
		return nil
	}

	// Ping goroutine: RFC 6455 keepalive. On missed pong it cancels connCtx,
	// unblocking the read loop and tearing the connection down.
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-connCtx.Done():
				return
			case <-ticker.C:
				pctx, pcancel := context.WithTimeout(connCtx, wsWriteTimeout)
				err := ws.Ping(pctx)
				pcancel()
				if err != nil {
					if !pstypes.IsWSClosedErr(err) {
						log.Debugf("websocket ping failed: %v", err)
					}
					cancel()
					return
				}
			}
		}
	}()

	// Start listening for websocket messages from client with raw
	// transaction bytes (hex encoded) to decode or broadcast.
	go func() {
		// Tearing down connCtx signals the broadcast loop to exit.
		defer cancel()
		defer closeWS()
		for {
			// Wait to receive a message on the websocket. Liveness is enforced
			// by the ping goroutine, not a per-read deadline.
			msg := &WebSocketMessage{}
			if err := wsjson.Read(connCtx, ws, msg); err != nil {
				if !pstypes.IsWSClosedErr(err) {
					log.Warnf("websocket client receive error: %v", err)
				}
				return
			}

			// handle received message according to event ID
			var webData WebSocketMessage
			//  If the request sent is past the limit continue to the next iteration.
			if len(msg.Message) > requestLimit {
				log.Debug("Request size over limit")
				webData.Message = "Request too large"
				continue
			}

			switch msg.EventId {
			case "decodetx":
				log.Debugf("Received decodetx signal for hex: %.40s...", msg.Message)
				tx, err := exp.dataSource.DecodeRawTransaction(ctx, msg.Message)
				if err == nil {
					message, err := json.MarshalIndent(tx, "", "    ")
					if err != nil {
						log.Warn("Invalid JSON message: ", err)
						webData.Message = errMsgJSONEncode
						break
					}
					webData.Message = string(message)
				} else {
					log.Debugf("Could not decode raw tx")
					webData.Message = fmt.Sprintf("Error: %v", err)
				}

			case "sendtx":
				log.Debugf("Received sendtx signal for hex: %.40s...", msg.Message)
				txid, err := exp.dataSource.SendRawTransaction(ctx, msg.Message)
				if err != nil {
					webData.Message = fmt.Sprintf("Error: %v", err)
				} else {
					webData.Message = fmt.Sprintf("Transaction sent: %s", txid)
				}

			case "getmempooltxs":
				// MempoolInfo. Used on mempool and home page.
				inv := exp.MempoolInventory()

				// Check if client supplied a mempool ID. If so, check that an update
				// is needed before sending.
				if msg.Message != "" {
					clientID, err := strconv.ParseUint(msg.Message, 10, 64)
					if err != nil {
						// For now, just log a warning and return the mempool anyway.
						log.Warn("Unable to parse supplied mempool ID %s", msg.Message)
					} else if inv.ID() == clientID {
						// Client is up-to-date. No need to send anything.
						continue
					}
				}

				inv.RLock()
				msg, err := json.Marshal(inv)
				inv.RUnlock()

				if err != nil {
					log.Warn("Invalid JSON message: ", err)
					webData.Message = errMsgJSONEncode
					break
				}
				webData.Message = string(msg)

			case "getmempooltrimmed":
				// TrimmedMempoolInfo. Used in visualblocks.
				// construct mempool object with properties required in template
				inv := exp.MempoolInventory()
				mempoolInfo := inv.Trim() // Trim internally locks the MempoolInfo.

				exp.pageData.RLock()
				mempoolInfo.Subsidy = exp.pageData.HomeInfo.NBlockSubsidy
				exp.pageData.RUnlock()

				msg, err := json.Marshal(mempoolInfo)

				if err != nil {
					log.Warn("Invalid JSON message: ", err)
					webData.Message = errMsgJSONEncode
					break
				}
				webData.Message = string(msg)

			case "getticketpooldata":
				data, errMsg := exp.buildTicketPoolChartsData(ctx, msg.Message)
				if errMsg != "" {
					webData.Message = errMsg
					break
				}
				msg, err := json.Marshal(data)
				if err != nil {
					log.Warn("Invalid JSON message: ", err)
					webData.Message = errMsgJSONEncode
					break
				}
				webData.Message = string(msg)

			case "ping":
				log.Tracef("We've been pinged: %.40s...", msg.Message)
				continue
			default:
				log.Warnf("Unrecognized event ID: %v", msg.EventId)
				continue
			}

			webData.EventId = msg.EventId + "Resp"

			if err := send(webData); err != nil {
				return
			}
		}
	}()

	// Send loop (ping, new tx, block, etc. update loop)
loop:
	for {
		// Wait for signal from the hub to update
		select {
		case sig, ok := <-updateSig:
			// Check if the update channel was closed. Either the websocket
			// hub will do it after unregistering the client, or forcibly in
			// response to (http.CloseNotifier).CloseNotify() and only then
			// if the hub has somehow lost track of the client.
			if !ok {
				break loop
			}

			if !sig.IsValid() {
				log.Errorf("invalid signal to send: %s / %d", sig.Signal.String(), int(sig.Signal))
				continue
			}

			log.Tracef("signaling client: %p", &updateSig)

			// Write block data to websocket client

			webData := WebSocketMessage{
				// Use HubSignal's string, not HubMessage's string, which is decorated.
				EventId: sig.Signal.String(),
				Message: "error",
			}
			buff := new(bytes.Buffer)
			enc := json.NewEncoder(buff)
			switch sig.Signal {
			case sigNewBlock:
				exp.pageData.RLock()
				err := enc.Encode(types.WebsocketBlock{
					Block: exp.pageData.BlockInfo,
					Extra: exp.pageData.HomeInfo,
				})
				exp.pageData.RUnlock()
				if err == nil {
					webData.Message = buff.String()
				} else {
					log.Errorf("json.Encode(WebsocketBlock) failed: %v", err)
				}

			case sigMempoolUpdate:
				inv := exp.MempoolInventory()
				inv.RLock()
				err := enc.Encode(inv.MempoolShort)
				inv.RUnlock()
				if err == nil {
					webData.Message = buff.String()
				} else {
					log.Errorf("json.Encode(MempoolShort) failed: %v", err)
				}

			case sigPingAndUserCount:
				// ping and send user count
				webData.Message = strconv.Itoa(exp.wsHub.NumClients())
			case sigNewTxs:
				// Do not use any tx slice in sig.Msg. Instead use client's
				// new transactions slice, newTxs. Attach current fill data
				// so the client can update indicators without waiting for
				// the next mempool event.
				inv := exp.MempoolInventory()
				inv.RLock()
				newTxsPayload := struct {
					Txs            []*types.MempoolTx               `json:"txs"`
					CoinFills      []types.CoinFillData             `json:"coin_fills"`
					TotalFillRatio float64                          `json:"total_fill_ratio"`
					ActiveSKACount int                              `json:"active_ska_count"`
					CoinStats      map[uint8]types.MempoolCoinStats `json:"coin_stats"`
				}{
					CoinFills:      inv.MempoolShort.CoinFills,
					TotalFillRatio: inv.MempoolShort.TotalFillRatio,
					ActiveSKACount: inv.MempoolShort.ActiveSKACount,
					CoinStats:      inv.MempoolShort.CoinStats,
				}
				inv.RUnlock()
				clientData.RLock()
				newTxsPayload.Txs = clientData.newTxs
				clientData.RUnlock()
				err := enc.Encode(newTxsPayload)
				if err == nil {
					webData.Message = buff.String()
				} else {
					log.Errorf("json.Encode(newTxsPayload) failed: %v", err)
				}

			case sigSyncStatus:
				err := enc.Encode(SyncStatus())
				if err == nil {
					webData.Message = buff.String()
				} else {
					log.Errorf("json.Encode([]SyncStatusInfo) failed: %v", err)
				}

			default:
				log.Errorf("RootWebsocket: Unhandled signal: %v", sig)
			}

			err := send(webData)
			if err != nil {
				return
			}

		case update := <-xcChan:
			buff := new(bytes.Buffer)
			enc := json.NewEncoder(buff)
			webData := WebSocketMessage{
				EventId: exchangeUpdateID,
				Message: "error",
			}
			err := enc.Encode(update)
			if err == nil {
				webData.Message = buff.String()
			} else {
				log.Errorf("json.Encode(*WebsocketExchangeUpdate) failed: %v", err)
			}
			err = send(webData)
			if err != nil {
				return
			}

		case <-exp.wsHub.quitWSHandler:
			break loop
		case <-connCtx.Done():
			break loop
		} // select
	} // for a.k.a. loop:
}

// buildTicketPoolChartsData assembles the payload returned by the
// "getticketpooldata" WebSocket request. It mirrors the REST handler
// appContext.getTicketPoolCharts so both transports emit the same
// apitypes.TicketPoolChartsData for a given chain/mempool state.
//
// On success it returns the chart payload and an empty error message; on
// failure it returns nil and the user-facing message that the WebSocket
// caller should report to the client.
func (exp *explorerUI) buildTicketPoolChartsData(ctx context.Context, intervalStr string) (*apitypes.TicketPoolChartsData, string) {
	interval := dbtypes.TimeGroupingFromStr(intervalStr)
	timeChart, priceChart, outputsChart, chartHeight, err :=
		exp.dataSource.TicketPoolVisualization(ctx, interval)
	if dbtypes.IsTimeoutErr(err) {
		log.Warnf("TicketPoolVisualization DB timeout: %v", err)
		return nil, "Error: DB timeout"
	}
	if err != nil {
		if strings.HasPrefix(err.Error(), "unknown interval") {
			log.Debugf("invalid ticket pool interval provided "+
				"via TicketPoolVisualization: %s", intervalStr)
			return nil, "Error: " + err.Error()
		}
		log.Errorf("TicketPoolVisualization error: %v", err)
		return nil, "Error: failed to fetch ticketpool data"
	}

	return &apitypes.TicketPoolChartsData{
		ChartHeight:  uint64(chartHeight),
		TimeChart:    timeChart,
		PriceChart:   priceChart,
		OutputsChart: outputsChart,
		Mempool:      exp.dataSource.GetMempoolPriceCountTime(),
	}, ""
}
