# Page-Rendering Impact (Cross-Domain Consolidation)

> Mode-4 consolidation of mutation risks whose failure mode or propagation path
> is shared by **2+ page-flow traces**. Domain flows link here via
> `depends-on`. Pairs with [patterns.md](patterns.md).

---

## Risk: `commonData` Nil Render Crash

**Trigger:**
`GetTip(ctx)` (Postgres) fails inside `exp.commonData(r)` — DB down, migration,
or tip query error. `commonData` logs and returns `nil`.

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (grounded: nil `.ChainParams` deref → `StatusPage`)
- /wiki/code-analysis/visualblocks/flow.full.md
- /wiki/code-analysis/charts/flow.full.md
- /wiki/code-analysis/address/flow.full.md
- /wiki/code-analysis/mempool/flow.full.md

(Every page using the `*CommonPageData` embedding pattern is exposed; only
parameters traces the concrete deref path today.)

**Failure mode:** loud (HTTP error page).

**Description:**
The nil `*CommonPageData` is still embedded in the page payload. Any template
that dereferences a common field (`.ChainParams.*`, `.Version`, `.NetName` —
effectively all pages) fails template execution → handler falls to
`StatusPage(defaultErrorCode, …, ExpStatusError)`. A single DB tip failure
takes down **every** server-rendered page simultaneously, not just one. A
handler that adds a new common-field deref without a nil guard widens nothing
(already total) but confirms there is no per-page isolation here.

---

## Risk: Saver Writer/Reader Drift (HTML ≠ WebSocket)

**Trigger:**
A computed field is added/changed in `(*explorerUI).Store` /
`(*explorerUI).StoreMPData` (HTTP path) without the matching change in
`PubSubHub.Store` / the WS encoders — or vice versa.

**Affected flows:**

- /wiki/code-analysis/block/flow.full.md ("update WebSocket only" → page flashes stale data before WS overwrite)
- /wiki/code-analysis/mempool/flow.full.md (derived view written into two call sites / two fields)
- /wiki/code-analysis/visualblocks/flow.full.md (`Store` + `StoreMPData` both update `pageData`/`invs`)

**Failure mode:** silent.

**Description:**
Each saver transforms the fan-out independently (no shared layer). When only
one saver is updated, the server-rendered HTML and the subsequent WebSocket
payload disagree: the page loads with one value, then the WS frame overwrites
it with another (visible "flash"), or per-coin fields render in HTML but are
absent from JSON snapshots. Propagation crosses Go→template and Go→JS
boundaries with no compile-time check. The mempool `CoinFills` case is the
sharpest: it is written into **two struct fields** (`inv.CoinFills` legacy +
`inv.MempoolShort.CoinFills` JSON) from **two call sites** (`Store` and
`StoreMPData`); missing any one desyncs HTTP pages from WS snapshots.

---

## Risk: Lock-Order Inversion Against `Store`

**Trigger:**
New code acquires `invsMtx` (or the embedded `MempoolInfo` lock) and **then**
waits on `pageData.Lock()`.

**Affected flows:**

- /wiki/code-analysis/visualblocks/flow.full.md (§4 explicit deadlock rule)
- /wiki/code-analysis/mempool/flow.full.md (reversing lock order risks deadlock)

**Failure mode:** loud (deadlock / hung request goroutine).

**Description:**
`(*explorerUI).Store` is the only path that nests `pageData.Lock()` →
`invsMtx.Lock()`. Any other goroutine holding `invsMtx` while blocking on
`pageData.Lock()` forms the classic AB/BA cycle with `Store` and hangs both —
manifesting as the page (and the block-processing pipeline) freezing on the
next block. Current code paths are safe because readers take the locks
sequentially (non-nested) and `StoreMPData` releases `pageData.RLock` before
taking `invsMtx`. The invariant is fragile: it is enforced by convention, not
structure.

---

## Cross-Domain Observation

These three risks share one root: **page handlers are pure readers of
background-written shared state behind a hand-maintained multi-lock, multi-saver
fan-out with no shared transformation layer.** Drift (silent) and lock
inversion (loud) are both consequences of "no shared layer"; the `commonData`
crash is the blast-radius amplifier (one shared dependency, every page). Any
refactor that introduces a shared transformation/render layer should treat all
three as a single design constraint, not three separate fixes.
