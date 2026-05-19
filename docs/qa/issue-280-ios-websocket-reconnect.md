# QA Test Plan — Issue #280: iOS WebSocket zombie connection

Scope: the client-side fix (work items #1 + #2). Verifies home-page live
updates survive iOS WebKit zombie sockets, that the connection indicator is
honest, and that live-inserted rows show a correct Age. Work item #3
(server RFC 6455 ping/pong) is out of scope and not tested here.

## Reference behavior (from the implemented fix)

These values drive the expected timings below — know them before testing:

- Client sends a JSON keep-alive ping every **7 s** (load-bearing: the server
  closes a silent socket after a **60 s** read deadline).
- Server pushes a `pingAndUserCount` frame about every **60 s** (the only
  guaranteed periodic inbound frame; `newblock` arrives only when a block is
  mined).
- Client heartbeat: if **no inbound frame for 90 s**, the socket is declared
  dead and reconnected (checked every 15 s → worst-case detection ≈ 90–105 s).
- Reconnect backoff: 1 s → 2 s → 4 s … capped at **30 s**, reset on success.
- Proactive reconnect: on `visibilitychange`→visible or `online`, reconnect
  immediately unless a frame arrived in the last **10 s**.
- Indicator: **green/"Connected"** only while frames are fresh;
  **non-green** "Connecting…/Reconnecting…/Disconnected" otherwise.

## Environment matrix

| ID  | Device / Browser                      | Notes                                                    |
| --- | ------------------------------------- | -------------------------------------------------------- |
| E1  | iPhone, **Safari**, page foregrounded | Primary target (reporter: iPhone 12 Pro Max, iOS 26.4.2) |
| E2  | iPhone, **Chrome**                    | Same WebKit engine — must behave identically to E1       |
| E3  | Desktop Chrome/Firefox                | Regression: no behavior change for normal users          |

Preconditions for all cases: explorer reachable, a node producing blocks
(testnet or mainnet), home page (`/`) is the page under test, browser
DevTools/console available where possible.

## Acceptance-criteria → test-case map

| AC (from issue)                                               | Test cases          |
| ------------------------------------------------------------- | ------------------- |
| New rows appear without manual refresh on iOS                 | TC-01, TC-08        |
| Dead/zombie socket detected ≤ ~30–45 s\* and auto-reconnected | TC-02, TC-03, TC-04 |
| Indicator reflects real liveness, not just initial open       | TC-05, TC-06        |
| Live-inserted rows show correct ticking Age on iOS            | TC-07               |
| No desktop regression                                         | TC-09, TC-10        |

\* Detection of a _pure foreground zombie_ is ≈90–105 s by design (server
only emits a frame every ~60 s, so a tighter timeout would false-fire — see
TC-03 rationale). The common real-world iOS case (lock/background) recovers in
≈1–3 s via the proactive trigger (TC-02), which is what the reporter hits.

---

## TC-01 — Baseline live updates (iOS)

- **Env:** E1, E2
- **Steps:**
  1. Open `/`, leave it foregrounded and untouched.
  2. Wait for several new blocks to be mined.
- **Expected:** New block rows prepend at the top of the latest-blocks table
  with no manual refresh; indicator stays green "Connected".
- **Pass/Fail:** **\_\_**

## TC-02 — Screen-lock / background recovery (the reported scenario)

- **Env:** E1, E2
- **Steps:**
  1. Open `/`, confirm green "Connected".
  2. Lock the phone screen (or switch apps) for **5+ minutes**.
  3. Unlock / return to the tab.
  4. Observe the indicator, then wait for the next mined block.
- **Expected:** On return, the socket reconnects within ~1–3 s (proactive
  `visibilitychange` trigger); indicator returns to green; subsequent blocks
  appear live. **No manual refresh required.**
- **Pass/Fail:** **\_\_**

## TC-03 — Pure foreground zombie (network silently dropped)

- **Env:** E1, E2
- **Steps:**
  1. Open `/`, confirm green "Connected", keep it foregrounded.
  2. Cut connectivity _without_ backgrounding the app: toggle Airplane Mode
     on, leave it on ~20 s, then **off again** (do not lock the screen).
  3. Keep the page foregrounded and wait up to ~2 minutes.
- **Expected:** Indicator goes non-green (Reconnecting…) within ≈90–105 s of
  the silence starting, then auto-reconnects to green; live blocks resume.
  No reload.
- **Rationale:** The server's only periodic frame is the ~60 s ping, so the
  heartbeat timeout is 90 s; a 30–45 s timeout would wrongly fire on a healthy
  idle link. (`online` event from step 2 may also accelerate recovery.)
- **Pass/Fail:** **\_\_**

## TC-04 — Reconnect backoff & recovery after server restart

- **Env:** E3 (easiest to control), spot-check E1
- **Steps:**
  1. Open `/`, confirm green.
  2. Stop the explorer server. Watch the indicator.
  3. Wait ~60 s (server down), then start the server again.
  4. Observe reconnection and live updates.
- **Expected:** Indicator goes non-green when the server drops. While down,
  reconnect attempts back off (≈1, 2, 4, 8 … s, capped at 30 s) — visible in
  DevTools Network/console, not a tight loop. Once the server is back, the
  socket reconnects, indicator returns to green, and live blocks resume
  **without page reload and without re-running page init** (handlers survived).
- **Pass/Fail:** **\_\_**

## TC-05 — Indicator honesty (no false green)

- **Env:** E1, E3
- **Steps:**
  1. Open `/`, confirm green "Connected".
  2. Disconnect the network (Airplane Mode / pull Wi-Fi).
  3. Observe the indicator during the dead window and during reconnect.
- **Expected:** Indicator does **not** stay green while the socket is dead. It
  shows a non-green Reconnecting…/Disconnected state during the dead/backoff
  window and only returns to green once frames actually flow again. (This is
  the core of the original complaint — the dot must not lie.)
- **Pass/Fail:** **\_\_**

## TC-06 — Indicator state on a fresh controller (Turbolinks nav)

- **Env:** E3
- **Steps:**
  1. Open `/` (green), navigate to another page and back to `/` (Turbolinks).
  2. Repeat the back-and-forth a few times.
- **Expected:** Indicator immediately reflects the true current state on each
  return (initialized from live state, not stuck/blank); no duplicate handler
  accumulation (live updates don't fire multiple times / no console spam).
- **Pass/Fail:** **\_\_**

## TC-07 — Live-inserted row shows a correct, ticking Age (iOS)

- **Env:** E1, E2
- **Steps:**
  1. Open `/`, wait for a block to be mined while watching the top row.
  2. Inspect the newly inserted row's Age cell over ~30 s.
- **Expected:** The new row's Age shows a sensible value (e.g. `0s`, `12s`,
  `1m`…) that ticks upward — **never `NaN`, never blank**. Matches the Age
  behavior of server-rendered rows.
- **Pass/Fail:** **\_\_**

## TC-08 — Extended soak (idle stability)

- **Env:** E1
- **Steps:**
  1. Open `/`, leave foregrounded and idle for **20–30 minutes** across
     multiple block intervals and several server ping cycles.
- **Expected:** No spurious reconnects while healthy (indicator stays green,
  no flicker), blocks keep appearing, Age keeps ticking. Confirms the 90 s
  heartbeat does not false-fire against the ~60 s server ping cadence.
- **Pass/Fail:** **\_\_**

## TC-09 — Desktop regression: normal live updates

- **Env:** E3
- **Steps:**
  1. Open `/`, leave open through several blocks.
- **Expected:** Identical to pre-fix behavior — blocks appear live, indicator
  green, no console errors/warnings, no extra network churn.
- **Pass/Fail:** **\_\_**

## TC-10 — Desktop regression: tab backgrounding

- **Env:** E3
- **Steps:**
  1. Open `/` (green). Switch to another tab for ~2 min. Return.
  2. Briefly disable then re-enable the OS network; return focus.
- **Expected:** On returning/visibility regain, if the socket is stale it
  reconnects promptly; if it was still alive (frame within 10 s) it does
  **not** needlessly reconnect. Live updates continue. No errors.
- **Pass/Fail:** **\_\_**

---

## Already covered by automated tests (informational)

These run in CI (`cd cmd/dcrdata && npm test`) and need no manual repetition;
manual cases above focus on real-device behavior automation can't reach:

- `public/js/services/messagesocket_service.test.js` — handler persistence
  across reconnect, heartbeat-timeout reconnect, no-reconnect while frames
  flow, capped backoff + reset, visibilitychange/online stale-vs-alive,
  manual close, connstate transitions.
- `public/js/controllers/connection_controller.test.js` — connected /
  reconnecting / closed mapping, init from current state, deregister on
  Stimulus disconnect.
- `public/js/helpers/humanize_helper.test.js` — `toUnixStamp` for RFC3339-Z,
  numeric offset, space-separated/tz-less fallback, and invalid → `NaN`.

## Notes for the tester

- `block.time` on the WebSocket wire is RFC3339 (e.g.
  `2025-05-19T14:30:45Z`). TC-07 is the user-visible check that parsing is
  engine-deterministic on WebKit.
- A bare WebSocket client that does **not** send the 7 s keep-alive ping is
  expected to be closed by the server at ~60 s (observed: close code 1006).
  This is normal server behavior, not a regression — the app client sends the
  ping and auto-reconnects.
- Record device model + exact iOS version with results; WebKit behavior is
  version-sensitive.
