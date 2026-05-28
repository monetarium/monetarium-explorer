# Manual Test Plan — WebSocket Transport

Scope: the real-time WebSocket channel between the browser and the explorer,
as integrated on `feat/ws-client-lib-integration` (partysocket on the client,
`coder/websocket` on the server).

This plan covers the **transport** — connect, keepalive, reconnect, send/receive
plumbing, buffering, and clean teardown — not the correctness of every rendered
value. Where a content check is needed it is only used as a signal that a message
arrived and was dispatched.

**Related:** the code-grounded engineering reference for this transport is the wiki
trace at [wiki/code-analysis/websocket/](../wiki/code-analysis/websocket/)
([flow.full.md](../wiki/code-analysis/websocket/flow.full.md),
[flow.compact.md](../wiki/code-analysis/websocket/flow.compact.md),
[patterns.md](../wiki/code-analysis/websocket/patterns.md),
[impact.md](../wiki/code-analysis/websocket/impact.md)). This document is the QA
counterpart — what to verify; the wiki trace explains how the transport works.

---

## 1. What's under test

Client (`cmd/dcrdata/public/`):

- `js/services/messagesocket_service.js` — the `MessageSocket` wrapper around
  partysocket `ReconnectingWebSocket`. Owns connect, the JSON `{event, message}`
  envelope, handler registry, the pre-connect send queue, and the synthetic
  `open` / `reconnect` / `close` / `error` events.
- `index.js` — builds the socket URI from `window.location`, waits 300 ms, then
  `ws.connect()`; registers the global `newblock` handler that fans out
  `BLOCK_RECEIVED` on the event bus.
- `js/controllers/connection_controller.js` — connection-status indicator;
  listens to `open` / `close` / `error` / `ping`.
- `js/controllers/homepage_controller.js`, `mempool_controller.js`,
  `ticketpool_controller.js`, `visualBlocks_controller.js` — feature consumers
  that send requests and re-request state on `reconnect`.

Server (`cmd/dcrdata/internal/explorer/`):

- `websockethandlers.go` — `RootWebsocket`, mounted at **`GET /ws`**
  (`cmd/dcrdata/main.go:663`). Per-connection reader, send loop, and ping
  goroutine.
- `websocket.go` — `WebsocketHub` fan-out and the 60 s ping / user-count tick.

### Transport facts to verify against (from the code)

| Behavior | Value / source |
| --- | --- |
| Endpoint | `GET /ws` (`ws://` on http, `wss://` on https — `index.js getSocketURI`) |
| Initial connect delay | 300 ms after page load (`index.js createWebSocket`) |
| Reconnect backoff | min 1 s, max 10 s, grow ×1.3 (`reconnectOptions`) |
| Connection open timeout | 4 s before a retry (`connectionTimeout`) |
| Retries / outbound buffer | unbounded (`maxRetries`, `maxEnqueuedMessages` = `Infinity`) |
| Pre-connect send queue | max 5 messages, flushed on `connect()` (`preConnectQueue`, `maxQlength`) |
| Server keepalive | RFC-6455 ping every 60 s; missed pong tears the connection down (`pingInterval`, ping goroutine) |
| App-level `ping` event | broadcast every 60 s, `message` = connected client count (`sigPingAndUserCount`) |
| Server write timeout | 10 s per write (`wsWriteTimeout`) |
| Read limit | 1 MiB per message (`SetReadLimit`) |
| Origin policy | any origin accepted (`OriginPatterns: ["*"]`) |

Client → server request events (response is `<event>Resp`):
`decodetx`, `sendtx`, `getmempooltxs`, `getmempooltrimmed`, `getticketpooldata`.
A client-sent `ping` is a server no-op. Unknown events are logged and ignored.

Server → client push events:
`newblock`, `mempool`, `newtxs`, `ping` (with user count), sync status.

---

## 2. Environment & tooling

### Build & run

```sh
cd cmd/dcrdata
npm clean-install && npm run build
go build -o monetarium-explorer .
./monetarium-explorer            # talks to the local node; web/API on :17778 (testnet)
```

The socket lives at `ws://localhost:17778/ws` for a local testnet instance
(adjust host/port to your deployment; use `wss://` behind TLS).

For live block / mempool / new-tx push events you need a node that is actually
producing activity (a local testnet, ideally one that mines on demand). Pure
connection-lifecycle tests (Sections A, E, G, H, I) do **not** require chain
activity.

### Generating chain activity & test data

The explorer talks to an external `monetarium-node`; this repo ships no CLI for
it, so the exact client binary/flags depend on your setup. Use your node's
JSON-RPC client (the `dcrctl`-equivalent) for the following — substitute the real
command name for your environment:

- **Mine a block on demand** (simnet/regtest-style nodes): the node's `generate`
  RPC. Needed for `newblock` (WS-C1), the ticket-pool refresh (WS-D4), and outage
  recovery where new blocks land while offline.
- **Create mempool activity / new txs** (WS-C2, WS-C3, WS-F1): send transactions
  from the node's wallet (`sendrawtransaction`, or a wallet `sendtoaddress`-style
  call). Each accepted tx produces a `newtxs` push and changes the mempool ID.
- **A raw-tx hex string for `decodetx`** (WS-D5): you do **not** need an
  unconfirmed or broadcastable tx — any serialized tx works. Fetch one from the
  running explorer: `GET /api/tx/hex/{txid}` for any known txid (copy a txid from
  a recent block page). Decoding is read-only and side-effect free.
- **A broadcastable tx for `sendtx`** (WS-D6): this *must* be a freshly signed,
  not-yet-broadcast tx spending real UTXOs — produce it with the node wallet
  (`createrawtransaction` + `signrawtransaction`) on testnet. This is
  environment-specific; mark Blocked if you lack a funded test wallet.

If your node cannot mine on demand, run Sections C/D/F opportunistically against
natural network activity and note the wait in the results table.

### Observation tools

1. **DevTools → Network → WS filter → click `/ws` → Messages tab.** Shows every
   frame: `↑` outbound, `↓` inbound, plus control frames (ping/pong). This is the
   ground truth for "did a frame go over the wire".
2. **Console debug logging.** In the page console run `logDebug(true)` (persists
   in `localStorage`). This sets `window.loggingDebug`, which:
   - logs every outbound `send` payload,
   - logs `Connected` / `Disconnected` and the `ping` user count,
   - logs `Block received: …`,
   - **enables partysocket's own internal logging** (connect attempts, backoff) —
     the primary tool for watching reconnection. Turn off with `logDebug(false)`.
3. **DevTools → Network → throttling dropdown → "Offline"** to drop the
   connection on demand, and back to "No throttling" / "Online" to restore it.
4. **Server logs** at debug/trace level for the matching server-side view
   (`websocket client receive error`, `Signaling new block to N … clients`,
   `Signaling ping/user count …`).

### Pages exercising the socket

- `/` (home) — `homepage_controller`, `visualBlocks_controller`, `newblock`.
- `/mempool` — `mempool_controller`.
- `/charts` ticket-pool view — `ticketpool_controller`.
- Connection indicator (`connection_controller`) is present site-wide.

---

## 3. Pre-flight checklist

- [ ] Frontend rebuilt from this branch (`npm run build`), binary rebuilt.
- [ ] Server reachable; an ordinary page (e.g. `/`) renders.
- [ ] Node is producing blocks/mempool activity (for Sections C/D/F).
- [ ] DevTools open, WS frames visible, `logDebug(true)` set.
- [ ] Note browser + OS for the run (repeat the matrix in Section 5).
- [ ] *(Optional, for console-driven cases WS-D5/D7, G2, J2)* Expose a debug
  handle on the socket — see Appendix (Section 7). Several cases are Blocked
  without it unless the corresponding in-app UI action is available.

---

## 4. Test cases

Each case: **Pre** (preconditions beyond pre-flight), **Steps**, **Expect**.
Record Pass/Fail/Blocked and notes in the tracking table (Section 9).

---

### A. Connection & handshake

#### WS-A1 — Socket opens on page load

- Steps: Load `/` with the Network/WS panel open.
- Expect: ~300 ms after load, a single `/ws` WebSocket appears with status
  `101 Switching Protocols`. Console logs `Connected`. The connection indicator
  shows the connected state.

#### WS-A2 — Correct URI scheme

- Steps: Load the page over `http://` then (if available) over `https://`,
  checking the WS request URL each time.
- Expect: `ws://<host>/ws` under http, `wss://<host>/ws` under https. Host/port
  match the page origin.

#### WS-A3 — Single connection per page

- Steps: With the page loaded, confirm the WS list.
- Expect: Exactly one `/ws` connection (no duplicate/churned sockets). Reloading
  the page closes the old socket and opens exactly one new one.

#### WS-A4 — Connect debounce on drive-by loads

- Steps: With one settled tab open as a baseline (note its user count N from
  WS-C4), rapidly reload a second tab ~10 times, abandoning each load within
  ~200 ms. Then wait for the next `ping` tick (~60 s).
- Expect: The 300 ms delay suppresses sockets for loads abandoned before connect.
  After things settle, the user count returns to N (or N+1 if you left the second
  tab open) — it must not be inflated by the ~10 abandoned loads. Any persistent
  count above the number of genuinely open tabs is a fail.

---

### B. Connection-status indicator (`connection_controller`)

#### WS-B1 — Connected state

- Steps: With a healthy socket, observe the indicator.
- Expect: Indicator is visible (not `hidden`), has `connected` class, status text
  reads `Connected`.

#### WS-B2 — Disconnected on drop

- Steps: Toggle DevTools **Offline**.
- Expect: Console logs `Disconnected`; indicator switches to `disconnected`,
  status text `Disconnected`. (Triggered by the `close`/`error` synthetic events.)

#### WS-B3 — Back to connected on restore

- Steps: Toggle back **Online**.
- Expect: Within the backoff window the socket reopens; indicator returns to
  `Connected`.

---

### C. Receiving server-pushed events

> Requires chain/mempool activity.

#### WS-C1 — `newblock`

- Pre: node will mine a block.
- Steps: Sit on `/`; trigger/await a new block. Watch WS Messages and console.
- Expect: Inbound frame with `event: "newblock"`; console `Block received: …`;
  the visual-blocks strip prepends a new block tile; a desktop notification fires
  if permission was granted.

#### WS-C2 — `mempool` update

- Steps: On `/` or `/mempool`, generate mempool activity.
- Expect: Inbound `event: "mempool"` frame; mempool figures/tables refresh. On
  `/mempool` and `/` a follow-up `getmempooltxs` request is sent automatically
  (see WS-D2). On the home visual-blocks, a `getmempooltrimmed` follow-up is sent.

#### WS-C3 — `newtxs` (buffered)

- Steps: Submit several transactions so the mempool grows.
- Expect: Inbound `event: "newtxs"` frames arriving either when 5 new txs have
  buffered or on the ~5 s buffer tick (whichever first). New rows animate into the
  latest-transactions list; fill indicators update.

#### WS-C4 — `ping` / user count (server push)

- Pre: `logDebug(true)`.
- Steps: Keep the page open ≥ 60 s.
- Expect: Roughly every 60 s an inbound `event: "ping"` frame whose `message` is
  the current connected-client count; console logs `ping. users online: N`. Open
  a second tab and confirm N increases; close it and confirm it decreases on the
  next tick.

#### WS-C5 — `blockchainSync` (sync status)

- Pre: a node/explorer that is catching up — i.e. start the explorer while the DB
  is still syncing, or against a node behind chain tip. This event
  (`SigSyncStatus` → `blockchainSync`, consumed by `status_controller.js`) is
  only emitted during sync, so it is **not observable on a fully-synced idle
  node** — mark Blocked/NA in that case.
- Steps: Load a page during sync and watch the sync-status UI and WS frames.
- Expect: Inbound `event: "blockchainSync"` frames driving the sync-progress
  display; frames stop once sync completes.

---

### D. Client-initiated request / response

#### WS-D1 — Initial mempool request on connect

- Steps: Load `/` (or `/mempool`); watch outbound frames immediately after open.
- Expect: An outbound `getmempooltxs` (the home/mempool controller's `connect`
  fires before the socket opens, so this is delivered via the buffer — see
  Section G) followed by an inbound `getmempooltxsResp` that populates the tables.

#### WS-D2 — `getmempooltxs` cache short-circuit

- Steps: Trigger a `mempool` push (WS-C2) and watch the follow-up
  `getmempooltxs` request — its `message` carries the current mempool ID. Allow a
  ~2 s window for any response before concluding none was sent (it's a negative
  observation).
- Expect: When the supplied ID matches the server's current inventory ID, no
  `getmempooltxsResp` arrives within the window (no redundant payload). When the
  ID is stale/empty, a full `getmempooltxsResp` is returned. The most reliable
  trip: on connect the controller sends `getmempooltxs` with the page's initial ID
  and should get a response; the post-`mempool` re-request with the matching ID
  should not.

#### WS-D3 — `getmempooltrimmed` (visual blocks)

- Steps: On `/`, trigger a `mempool` push.
- Expect: Outbound `getmempooltrimmed` → inbound `getmempooltrimmedResp`; the
  mempool tile in the visual-blocks strip re-renders.

#### WS-D4 — `getticketpooldata` (charts)

- Steps: Open the ticket-pool charts view; await a `newblock`.
- Expect: Outbound `getticketpooldata` (with the current bars selection) →
  inbound `getticketpooldataResp`; charts update without a full page reload.

#### WS-D5 — `decodetx`

- Pre: a raw tx hex string. Get one with `GET /api/tx/hex/{txid}` for any txid
  copied from a recent block page (decode is read-only; the tx need not be
  unconfirmed). Use the console handle from the Appendix, or the decode-tx UI if
  present.
- Steps: `ws.send('decodetx', '<hex>')`. Then repeat with deliberately invalid
  hex (e.g. `'zzzz'`).
- Expect: Valid hex → inbound `decodetxResp` containing the decoded JSON. Invalid
  hex → `decodetxResp` whose `message` is an `Error: …` string; connection stays
  open.

#### WS-D6 — `sendtx` *(environment-specific; Blocked without a funded test wallet)*

- Pre: a freshly signed, not-yet-broadcast testnet raw tx — see "Generating chain
  activity & test data" in Section 2.
- Steps: Submit via the send-tx UI, or `ws.send('sendtx', '<signed-hex>')`.
- Expect: Inbound `sendtxResp` with `Transaction sent: <txid>` on success, or
  `Error: …` on rejection. Connection unaffected either way.

#### WS-D7 — Unknown event is ignored

- Steps: From the console, `ws.send('bogusEvent', 'x')`.
- Expect: No response frame; server logs `Unrecognized event ID: bogusEvent`;
  connection remains open and continues to receive pushes.

---

### E. Reconnection & backoff

#### WS-E1 — Reconnect after transient drop (Offline/Online)

- Pre: `logDebug(true)`.
- Steps: Offline for ~5 s, then Online.
- Expect: On drop: `close`, indicator `Disconnected`. While offline: partysocket
  logs retry attempts at ~1 s, ~1.3 s, ~1.7 s … (growing toward the 10 s cap).
  On restore: socket reopens, indicator `Connected`, and the `reconnect`
  synthetic event fires (verify via Section F recovery, not just `open`).

#### WS-E2 — Reconnect after server restart

- Steps: Kill and restart the explorer binary while the page stays open.
- Expect: Client detects the drop, retries with backoff, reconnects once the
  server is back, and recovers state (Section F). No page reload required.

#### WS-E3 — Backoff cap

- Steps: Stop the server and leave it down for ~1 min with partysocket logging on.
- Expect: Retry interval grows but never exceeds ~10 s; retries continue
  indefinitely (no "give up").

#### WS-E4 — Connection-open timeout *(best-effort; needs a way to blackhole the port)*

- Steps: Make the handshake hang rather than fail fast — DevTools throttling is
  unreliable for this. Prefer a firewall rule that *drops* (not rejects) traffic
  to the explorer port while a tab is open, e.g. macOS `pf` /
  `sudo /sbin/pfctl` blocking the port, or Linux
  `sudo iptables -A INPUT -p tcp --dport 17778 -j DROP`. Then keep the page open.
- Expect: After ~4 s without an open, partysocket abandons the attempt and
  schedules another (visible as repeated attempts in the partysocket log). If you
  cannot blackhole the port, mark Blocked.

#### WS-E5 — `open` vs `reconnect` semantics

- Pre: `logDebug(true)`.
- Steps: Watch the very first connect, then force one reconnect (WS-E1).
- Expect: The first open fires `open` only. Every later open fires `open` **and**
  `reconnect`. (This is what drives the re-request behavior in Section F.)

---

### F. State recovery on reconnect

> The point of the `reconnect` event: re-pull anything missed while down.

#### WS-F1 — Home/mempool re-request

- Steps: On `/` or `/mempool`, go Offline; while offline let mempool change
  (submit txs from elsewhere); go Online.
- Expect: On reconnect an outbound `getmempooltxs` (empty ID) is sent and the
  tables refresh to reflect activity that occurred during the outage — no manual
  reload needed.

#### WS-F2 — Visual-blocks re-request

- Steps: Same outage on `/`, watching the visual-blocks strip.
- Expect: On reconnect an outbound `getmempooltrimmed` is sent and the mempool
  tile re-renders.

#### WS-F3 — Ticket-pool re-request

- Steps: Same outage on the charts view.
- Expect: On reconnect an outbound `getticketpooldata` is sent and the charts
  refresh.

#### WS-F4 — No duplicate handlers after several reconnects

- Steps: Force 3–4 reconnect cycles, then trigger one `mempool`/`newblock` push.
- Expect: Each push is handled exactly once (one re-request per consumer, one row
  inserted per tx). No multiplying requests or duplicated DOM rows — the symptom
  of leaked handlers across reconnects.

---

### G. Outbound buffering

#### WS-G1 — Pre-connect queue flush

- Steps: Hard-reload `/` and watch outbound frames from the very first moment the
  socket opens.
- Expect: Requests issued by controllers during Stimulus `connect` (before the
  300 ms-deferred `ws.connect`) are buffered, then delivered in order the instant
  the socket opens (you should see `getmempooltxs` etc. go out right at open, not
  be lost).

#### WS-G2 — Pre-connect queue cap (max 5)

- Steps: Before the socket opens (within the 300 ms window, or via the Appendix
  trick of calling `ws.send` repeatedly before `connect`), issue > 5 sends.
- Expect: Only the **last 5** are retained and flushed; the oldest are dropped
  (`maxQlength`). No error thrown.

#### WS-G3 — Send while temporarily disconnected

- Steps: Go Offline, trigger an action that calls `ws.send` (e.g. change the
  charts bars selection, or a manual `ws.send`), then go Online.
- Expect: partysocket enqueues the outbound message and delivers it on reconnect
  (unbounded `maxEnqueuedMessages`); the corresponding `*Resp` arrives after
  reconnect. Nothing is silently lost.

---

### H. Keepalive / zombie detection

#### WS-H1 — Protocol ping/pong

- Steps: Idle on a page ≥ 60 s with the WS Messages panel open.
- Expect: A control ping frame from the server roughly every 60 s, with an
  automatic pong from the browser. Connection stays open across multiple cycles.

#### WS-H2 — Server tears down a dead client *(best-effort; OS-dependent)*

- Steps: Force a *half-open* connection — TCP silently dead with no close frame.
  Best done by dropping (not rejecting) the port at the OS firewall while the tab
  stays open (same `pf`/`iptables -j DROP` technique as WS-E4); suspending the
  laptop or hard-killing Wi-Fi also works but is flakier on a shared box. Keep it
  cut for > ~60–70 s (one ping cycle plus the 10 s write timeout), watching server
  logs and the user count (WS-C4).
- Expect: The server's ping write fails, it cancels the connection context and
  unregisters the client; the reported user count drops by one within ~70 s. When
  connectivity returns, partysocket reconnects. If you cannot blackhole the port,
  mark Blocked.

#### WS-H3 — Client sends no app-level pings

- Steps: Idle with `logDebug(true)`; inspect outbound frames.
- Expect: No periodic outbound `ping` frames originate from the client (keepalive
  is protocol-level only). The only outbound traffic is genuine requests.

---

### I. Teardown & handler hygiene

#### WS-I1 — Clean disconnect on navigation

- Steps: Navigate between `/`, `/mempool`, and the charts view.
- Expect: On each navigation, controllers' `disconnect` deregisters their
  handlers and unsubscribes their `reconnect` handler; no console errors. The
  socket itself persists across in-app navigation (it is a singleton) — verify it
  is **not** reopened on every navigation.

#### WS-I2 — No status-handler leak (connection_controller)

- Steps: Navigate away from and back to a page that mounts the connection
  indicator several times, then force one `open`/`close` cycle (WS-E1).
- Expect: The status updates once per event, not N times — `disconnect`
  deregistered the prior handlers. (Mirrors the automated cleanup test.)

#### WS-I3 — Tab close unregisters server-side

- Steps: Open a second tab (user count = 2 via WS-C4), close it.
- Expect: On the next `ping` tick the count returns to 1; server logs the
  unregistration. No leaked server-side client.

---

### J. Negative & edge cases

#### WS-J1 — Malformed inbound JSON *(optional; needs frame-injection tooling)*

- Steps: Requires injecting a non-JSON inbound frame, which the listed DevTools
  cannot do. Use an intercepting WS proxy (e.g. `mitmproxy` with a script that
  rewrites a `/ws` text frame, or a one-off local relay) to deliver a malformed
  frame. If no such tooling is set up, mark Blocked/NA.
- Expect: `onmessage` does `JSON.parse` with no try/catch, so a bad frame throws.
  Confirm whether this wedges the socket or is shrugged off, and record the actual
  behavior (this case exists to document the failure mode, not to assert a pass).

#### WS-J2 — Oversized request

- Steps: From the console, `ws.send('decodetx', 'a'.repeat(2*1024*1024))`
  (≈ 2 MiB, over the 1 MiB read limit).
- Expect: The server rejects the frame (read limit exceeded → connection torn
  down, or the request dropped with `Request size over limit` logged). Confirm
  the client recovers (reconnects) and stays usable; document which path occurs.

#### WS-J3 — Server `getmempooltrimmed` before startup data ready

- Steps: Immediately after a fresh server start (before the first block is
  collected), load `/` and trigger a `getmempooltrimmed`.
- Expect: Server skips the response (logs `getmempooltrimmed requested before
  blockchain info is ready; skipping`); the client re-requests on the next
  mempool push / reconnect. No crash, no stuck UI.

#### WS-J4 — Rapid reconnect storm

- Steps: Toggle Offline/Online quickly several times in a row.
- Expect: No runaway socket creation, no unhandled promise rejections; the system
  settles into a single healthy connection once Online is stable.

---

## 5. Cross-environment matrix

Run the golden path (WS-A1, B1–B3, C1, E1, F1) on each:

| Browser | Connect | Status UI | Receive push | Reconnect | Recovery |
| --- | --- | --- | --- | --- | --- |
| Chrome (desktop) | | | | | |
| Firefox (desktop) | | | | | |
| Safari (desktop) | | | | | |
| Safari (iOS) | | | | | |
| Chrome (Android) | | | | | |

Also vary network: clean LAN, throttled (Slow 3G), and a flaky/intermittent link.
iOS Safari is the documented motivation for the keepalive — give WS-H2 extra
attention there (background the tab, then foreground it).

---

## 6. Exit criteria

- All Section A, B, E (except E4), F, G, I cases Pass (transport core +
  lifecycle).
- Section C/D Pass given available chain activity / test data, else Blocked with a
  stated reason (notably C5, D6 are environment-gated).
- Section H: WS-H1 and WS-H3 Pass. WS-H2 and WS-E4 require OS-level port
  blackholing — Pass if performed, otherwise Blocked with a reason (not a Fail).
- Section J: behaviors documented. J2/J3 Pass; J1 may be Blocked if no
  frame-injection tooling is available.
- No console errors, no unhandled rejections, no leaked sockets/handlers across
  navigation and reconnect cycles.
- Cross-environment matrix green for at least Chrome + Firefox + one Safari.

A case is **Blocked**, not **Failed**, when the environment lacks the tooling the
case itself flags as required. Blocked cases do not gate release but must carry a
reason so coverage gaps are visible.

---

## 7. Appendix — driving the socket from the console

The service is a singleton module; the page does not expose it globally, so use
DevTools to exercise raw frames. The cleanest approach is to add a temporary
debug handle while testing, e.g. in `index.js` during a local build:

```js
// TEMP, do not commit:
import ws from './js/services/messagesocket_service'
window.ws = ws
```

Then in the console:

```js
ws.send('getmempooltxs', '')                 // force a full mempool request
ws.send('getticketpooldata', 'all')          // request ticket-pool charts
ws.send('decodetx', '<raw-tx-hex>')          // decode
ws.send('bogusEvent', 'x')                    // unknown-event handling (WS-D7)
ws.registerEvtHandler('newblock', m => console.log('block!', m))
ws.close()                                    // clean close (no reconnect)
```

Without the temp handle, rely on the in-app actions plus the Network/WS Messages
panel, which already shows every frame in both directions.

---

## 8. Notes for the tester

- The connection is a **singleton** shared by all controllers — many behaviors
  (reconnect, buffering, keepalive) are global, so test them once per page type
  rather than per widget.
- Distinguish the two "pings": the RFC-6455 **control** ping (binary keepalive,
  WS-H1) vs. the application **`ping` event** carrying the user count (WS-C4).
  They share the 60 s cadence but are different mechanisms.
- A reconnect is only observable through the `reconnect` event's side effects
  (the re-requests in Section F) — `open` alone fires on first connect too, so
  use Section F to prove a true reconnect happened.

---

## 9. Results tracking

| Case | Browser/Env | Result (P/F/B) | Notes / evidence |
| --- | --- | --- | --- |
| WS-A1 | | | |
| WS-A2 | | | |
| WS-A3 | | | |
| WS-A4 | | | |
| WS-B1 | | | |
| WS-B2 | | | |
| WS-B3 | | | |
| WS-C1 | | | |
| WS-C2 | | | |
| WS-C3 | | | |
| WS-C4 | | | |
| WS-C5 | | | |
| WS-D1 | | | |
| WS-D2 | | | |
| WS-D3 | | | |
| WS-D4 | | | |
| WS-D5 | | | |
| WS-D6 | | | |
| WS-D7 | | | |
| WS-E1 | | | |
| WS-E2 | | | |
| WS-E3 | | | |
| WS-E4 | | | |
| WS-E5 | | | |
| WS-F1 | | | |
| WS-F2 | | | |
| WS-F3 | | | |
| WS-F4 | | | |
| WS-G1 | | | |
| WS-G2 | | | |
| WS-G3 | | | |
| WS-H1 | | | |
| WS-H2 | | | |
| WS-H3 | | | |
| WS-I1 | | | |
| WS-I2 | | | |
| WS-I3 | | | |
| WS-J1 | | | |
| WS-J2 | | | |
| WS-J3 | | | |
| WS-J4 | | | |
