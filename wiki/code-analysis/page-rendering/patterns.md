# Page-Rendering Patterns (Cross-Domain Consolidation)

> Mode-4 consolidation of architectural behaviors that recur across **2+
> page-flow traces**. These are the shared mechanics of every server-rendered
> HTML page in `cmd/dcrdata/internal/explorer`. Domain flows link here via
> `shares-pattern-with`; do not re-describe these per domain.

---

## Out-of-Band Shared Page State (`explorerUI.pageData` / `exp.invs`)

**Appears in:**

- /wiki/code-analysis/block/flow.full.md
- /wiki/code-analysis/mempool/flow.full.md
- /wiki/code-analysis/visualblocks/flow.full.md
- /wiki/code-analysis/parameters/flow.full.md
- /wiki/code-analysis/charts/flow.full.md

**Description:**
HTTP page handlers do **not** fetch live chain state themselves. They read
`exp.pageData` (block/blockchain/`HomeInfo`) and `exp.invs`
(`*MempoolInfo`), which are populated **out-of-band** by the saver fan-out:

- `(*explorerUI).Store` is a `BlockDataSaver` hook — registered alongside
  `pgb` and `psHub` in `cmd/dcrdata/main.go`. On every block it rewrites
  `pageData.{BlockInfo,BlockchainInfo,HomeInfo}` (`explorer.go` `Store`).
- `(*explorerUI).StoreMPData` is a `MempoolDataSaver` hook. On every mempool
  change it recomputes `CoinFills` and swaps `exp.invs`.

Each saver (`ChainDB`, `explorerUI`, `PubSubHub`) processes the fan-out
independently with no shared transformation layer. The page handler is a
**pure reader** of a snapshot last written by a background goroutine.

**Constraints:**

- A handler reading `pageData`/`invs` must assume the value is from the *last*
  block/mempool tick, not the request instant. `BlockchainInfo` is `nil` for
  non-tip states by design — every reader needs a fallback.
- New per-page data that derives from chain state belongs in the page handler's
  own struct, **not** in `pageData` (shared by all pages) and **not** computed
  inside `commonData`.
- Any computed field added to `Store`/`StoreMPData` must be added to **all**
  savers that expose it, or the HTTP path and WS path diverge (see
  `impact.md` → *Saver Writer/Reader Drift*).

---

## Shared-State Lock Discipline (`pageData.RWMutex` + `invsMtx`)

**Appears in:**

- /wiki/code-analysis/visualblocks/flow.full.md (§4 lock map)
- /wiki/code-analysis/mempool/flow.full.md (inventory locking)
- /wiki/code-analysis/parameters/flow.full.md
- /wiki/code-analysis/block/flow.compact.md

**Description:**
Three distinct locks guard the shared page state, and they are **not** a
single hierarchy:

- `pageData.RWMutex` — guards `pageData` struct contents.
- `invsMtx` on `explorerUI` — guards the `exp.invs` **pointer**.
- `MempoolInfo.RWMutex` (embedded) — guards inventory **contents**.

Writers: `Store` is the only path that *nests* two locks —
`pageData.Lock()` then `invsMtx.Lock()`
([explorer.go:547,608-614](../../../cmd/dcrdata/internal/explorer/explorer.go#L547-L614)).
`StoreMPData` takes `pageData.RLock`, releases it, *then* takes `invsMtx.Lock`
— not nested. Readers (page handlers) acquire `invsMtx.RLock` →
`MempoolInfo.RLock` → `pageData.RLock` **sequentially**, never nested.

**Constraints:**

- Reading any `pageData` field (e.g. `BlockchainInfo.MaxBlockSize` in
  `ParametersPage`) **must** be under `pageData.RLock()`. Unlocked reads race
  against `Store`.
- The narrow deadlock rule: code that holds `invsMtx` (or the inventory lock)
  and then waits on `pageData.Lock()` deadlocks against `Store`. Acquire
  `pageData` first or not-nested.
- `DeepCopy`/`Trim` already lock internally — do not wrap them in an outer lock
  of the same instance.

---

## `*CommonPageData` Struct-Embedding Template Injection

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (`{*CommonPageData, ExtendedParams}`)
- /wiki/code-analysis/visualblocks/flow.full.md (anonymous struct embedding `*CommonPageData`)
- /wiki/code-analysis/charts/flow.full.md (`{*CommonPageData, Premine, TargetPoolSize, ActiveSKATypes}`)
- /wiki/code-analysis/address/flow.full.md (`AddressPageData → templates.exec`)
- /wiki/code-analysis/mempool/flow.full.md

**Description:**
Every server-rendered page builds its template payload by **Go struct
embedding**: an anonymous struct embeds `*CommonPageData` (from
`exp.commonData(r)`) alongside a page-specific struct. The template addresses
both via dotted paths (`.ChainParams.*` from common, `.ExtendedParams.*` /
`.Premine` / etc. from the page struct). There is no merge step — embedding
*is* the merge at the `templates.exec(...)` call.

`commonData` is **shared by every page**: it injects static `exp.ChainParams`,
`Version`, `NetName`, cookies, and calls `GetTip(ctx)` (Postgres) for the
header tip. On `GetTip` failure it logs and **returns `nil`**.

**Constraints:**

- Template field names must resolve to a field on the embedded common struct
  **or** the page struct. Adding a row requires knowing which source owns it.
- Page-specific computed values go in the page struct, never in `commonData`
  (changing `commonData` touches every page).
- `commonData` returning `nil` makes the embedded pointer nil; templates that
  deref `.ChainParams` (effectively all) then fail — see `impact.md` →
  *commonData Nil Render Crash*.
- `exp.ChainParams` is captured **once at startup**; node config changes need
  an explorer restart to surface in any page.

---

## Block-Scoped ETag / Last-Modified Page Cache

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (`withCache` / `ETagAndLastModifiedIntercept`)
- /wiki/code-analysis/mempool/flow.full.md (`Store` resets the page ETag/Last-Modified)

**Description:**
Pages whose content depends only on block/mempool state are registered under
`withCache = r.With(explore.ETagAndLastModifiedIntercept)` in
`cmd/dcrdata/main.go`. The middleware
([explorermiddleware.go:193](../../../cmd/dcrdata/internal/explorer/explorermiddleware.go#L193))
sets `ETag`/`Last-Modified`; the cache key is **reset by `Store` /
`StoreMPData`** on every new block/mempool tick. Between ticks the response is
served from cache.

**Constraints:**

- Any handler placed under `withCache` must be a pure function of
  `pageData`/`invs` at the last tick. A handler that varies per-request on
  anything *other* than block/mempool state (e.g. a query param affecting
  output) will serve stale cached bytes — do **not** put it under `withCache`.
- New invalidation triggers must reset the ETag in the same place `Store` does;
  a new state source that doesn't reset it is silently stale until the next
  block.
- Stale-looking content between blocks (e.g. `/parameters` `MaxBlockSize`) is
  expected and intentional, not a bug.
