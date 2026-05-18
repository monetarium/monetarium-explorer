# Parameters Page — Data Flow (Full)

> Code-grounded trace of `/parameters`. Verified at branch `feat/address-page`.
> The page is **~95% static chain config**; exactly **one field is dynamic**
> (`MaximumBlockSize`) plus the shared `commonData` header.

---

## Section 1 — Overview

`/parameters` renders the active network's consensus parameters: PoW/PoS
constants, subsidy/reward proportions, ticket economics, and address prefixes.
Almost every row is read directly off the immutable `chaincfg.Params` captured
at process start. The handler adds three derived values (`ExtendedParams`) and
the shared `commonData` header. Caching is intentional and block-scoped.

---

## Section 2 — End-to-End Data Flow

```
monetarium-node
 ├─ chaincfg.Params (static, launch-time) ──► ChainDB.chainParams ──► GetChainParams()
 │                                                                        │
 │                                              explorerUI.New: exp.ChainParams = params
 │                                                                        │
 └─ RPC GetBlockChainInfo (per block) ──► blockdata.BlockData.BlockchainInfo
                                                                          │
                                            explorerUI.Store: p.BlockchainInfo = ...
                                                                          │
   GET /parameters ──► ETagAndLastModifiedIntercept ──► ParametersPage ◄──┘
                                                          │
                    ┌─────────────────────────────────────┤
                    │ commonData(r): GetTip() [Postgres]   │ derive ExtendedParams
                    │   + exp.ChainParams                   │   + AddressPrefixes(params)
                    └─────────────────────────────────────┤
                                                          ▼
                                      templates.exec("parameters", {CommonPageData + ExtendedParams})
                                                          ▼
                                                parameters.tmpl ──► HTML
```

---

## Section 3 — Per-Layer Breakdown

### Node / static config

- **Location:** `db/dcrpg/pgblockchain.go:6408-6410`
- **Data structures:** `*chaincfg.Params` (from `monetarium-node`)
- **Transformations:** none — `GetChainParams()` returns `pgb.chainParams` verbatim.

### Capture at startup

- **Location:** `cmd/dcrdata/internal/explorer/explorer.go:369-371`
- **Data structures:** `exp.ChainParams *chaincfg.Params`, `exp.NetName`
- **Transformations:** `exp.ChainParams = exp.dataSource.GetChainParams()` once;
  `exp.NetName = netName(exp.ChainParams)`. **Process-lifetime constant.**

### Dynamic field source (RPC)

- **Location:** `blockdata/blockdata.go:332-357`
- **Data structures:** `chainjson.GetBlockChainInfoResult` (field
  `BlockData.BlockchainInfo`, defined `blockdata/blockdata.go:38`)
- **Transformations:** `chainInfo, err := t.dcrdChainSvr.GetBlockChainInfo(ctx)`.
  Critically, `blockdata.go:339-341` **nulls** `chainInfo` unless
  `chainInfo.BestBlockHash == hash.String()` — `GetBlockChainInfo` is only
  valid at the chain tip.

### Store into pageData

- **Location:** `cmd/dcrdata/internal/explorer/explorer.go:536-572`
- **Data structures:** `pageData` (struct `explorer.go:230-233`,
  `RWMutex`-guarded), field `BlockchainInfo *chainjson.GetBlockChainInfoResult`
- **Transformations:** under `p.Lock()`: `p.BlockchainInfo = blockData.BlockchainInfo`.

### Handler

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:2144-2184`
- **Data structures:** anonymous `struct{ *CommonPageData; ExtendedParams }`;
  `ExtendedParams{ MaximumBlockSize int64; ActualTicketPoolSize int64; AddressPrefix []types.AddrPrefix }`
- **Transformations:**
  - `addrPrefix := types.AddressPrefixes(params)`
  - `actualTicketPoolSize := int64(params.TicketPoolSize * params.TicketsPerBlock)`
  - `maxBlockSize`: under `pageData.RLock()`, `BlockchainInfo.MaxBlockSize` if
    non-nil, else `int64(params.MaximumBlockSizes[0])` (`:2150-2156`)

### commonData (shared header)

- **Location:** `explorerroutes.go:2534-2572`
- **Data structures:** `*CommonPageData{ Tip, Version, ChainParams, BlockTimeUnix, NetName, … }`
- **Transformations:** `GetTip(ctx)` → `exptypes.WebBasicBlock` (Postgres,
  `db/dcrpg/pgblockchain.go:7319-7348`). On error logs and **returns `nil`**
  (`:2540`). Re-injects `exp.ChainParams` and
  `BlockTimeUnix = int64(exp.ChainParams.TargetTimePerBlock.Seconds())`.

### AddressPrefixes transform

- **Location:** `explorer/types/explorertypes.go:1508-1549`
- **Data structures:** `[]AddrPrefix{ Name, Prefix, Description }`
- **Transformations:** index-aligned `Name`/`Descriptions` arrays selected
  against a **hardcoded** network prefix table keyed by `params.Name`
  (`mainnet` / `testnet*` / `simnet`). **Returns `nil` for any other name** (`:1549`).

### Template

- **Location:** `cmd/dcrdata/views/parameters.tmpl` (392 lines)
- **Data structures:** consumes `.ChainParams.*` (~40 rows) from the embedded
  `CommonPageData`, and `.ExtendedParams.{MaximumBlockSize,ActualTicketPoolSize,AddressPrefix}`.
- **Transformations:** template helpers `amountAsDecimalParts`,
  `durationToShortDurationString`, `uint16Mul` (e.g. `WorkRewardProportion`).

### Route

- **Location:** `cmd/dcrdata/main.go:810`
- `withCache.Get("/parameters", explore.ParametersPage)` where
  `withCache = r.With(explore.ETagAndLastModifiedIntercept)`
  (`explorermiddleware.go:193`).

---

## Section 4 — Cross-Layer Dependencies

- **Dual param injection (brittle):** the template binds `.ChainParams` from
  `CommonPageData` (via `commonData`) **and** `.ExtendedParams` from the
  handler's anonymous struct, merged by Go struct embedding at the
  `templates.exec` call (`explorerroutes.go:2164-2174`). Adding a template row
  requires knowing which of the two sources owns the field.
- **`commonData` is shared by every page**, not just `/parameters`. Changing it
  to satisfy this page risks all pages. Page-specific data belongs in
  `ExtendedParams`.
- **`GetChainParams` is broad**: it seeds `exp.ChainParams` once at startup and
  feeds `commonData` for every page render.
- **`BlockchainInfo` is shared state**: also read by `StoreMPData`
  (`explorer.go:506`) and other pages — not isolated to `/parameters`.
- **Tip↔nil coupling:** `commonData` returning `nil` (DB tip fetch failure)
  makes the embedded `*CommonPageData` nil; the template then dereferences
  `.ChainParams` off nil → template execute error.

---

## Section 5 — Critical Constraints

- **Lock discipline:** `pageData.BlockchainInfo` must be read under
  `pageData.RLock()` (`explorerroutes.go:2149-2156`); writer `Store` holds
  `p.Lock()` (`explorer.go:568`). Reading outside the RLock is a data race.
- **Tip-only RPC validity:** `BlockchainInfo` is intentionally `nil` for
  non-tip blocks (`blockdata.go:339-341`); the handler fallback to
  `params.MaximumBlockSizes[0]` exists precisely for this.
- **Multi-coin / VAR-only page:** subsidy and reward rows (`BaseSubsidy`,
  `WorkRewardProportion`, `StakeRewardProportion`, `BlockTaxProportion`,
  `MinimumStakeDiff` — `parameters.tmpl:119-168`) are VAR-only scalars from
  `chaincfg.Params`. SKA coins are **not** represented here. Do not inject
  per-coin maps without confirming the param model (see `REWARDS_LOGIC.md`).
- **Static for process lifetime:** `exp.ChainParams` is never refreshed after
  startup; a node config change requires an explorer restart to reflect here.
- **Network-name coupling:** `AddressPrefixes` has hardcoded prefix strings and
  only recognizes `mainnet`/`testnet*`/`simnet` (`explorertypes.go:1540-1549`).
- **Cache is block-scoped & intentional:** served under
  `ETagAndLastModifiedIntercept`; ETag/Last-Modified reset on new block/mempool.
  Stale-looking content between blocks is expected (only `MaxBlockSize` moves).

---

## Section 6 — Mutation Impact

When modifying `/parameters` data, check:

**Direct dependencies**

- `parameters.tmpl` field names must exist on `*chaincfg.Params` (via
  `.ChainParams`) or on `ExtendedParams` (`explorerroutes.go:2158-2162`).
- `AddressPrefixes` callers: only `ParametersPage` (`explorerroutes.go:2146`) —
  low blast radius, but `Name`/`Descriptions`/prefix arrays must stay
  index-aligned (`explorertypes.go:1517-1538`).

**Indirect dependencies**

- `commonData` → every page. `GetChainParams` → every page.
- `BlockchainInfo` type/`Store` assignment → home page, `StoreMPData`.

**Serialization boundaries**

- RPC: `GetBlockChainInfo` → `chainjson.GetBlockChainInfoResult`
  (`blockdata.go:334`).
- DB: `GetTip` → `retrieveLatestBlockSummary` SQL
  (`pgblockchain.go:7319-7348`).

**Rendering layers**

- `parameters.tmpl` + helpers (`amountAsDecimalParts`,
  `durationToShortDurationString`, `uint16Mul`).

### Hard failures (HTTP error page)

- `templates.exec("parameters", …)` error →
  `StatusPage(defaultErrorCode, …, ExpStatusError)`
  (`explorerroutes.go:2176-2179`). Causes: missing template field; `commonData`
  nil (DB down) → nil `*CommonPageData` → nil `.ChainParams` deref.
- `GetTip` DB error → nil `CommonPageData` → cascades to the above.

### Silent failures (HTTP 200, wrong/blank data)

- Unrecognized `params.Name` → `AddressPrefixes` returns `nil` → empty address
  table, no error (`explorertypes.go:1549`).
- `BlockchainInfo == nil` (between blocks, or RPC warn-and-continue at
  `blockdata.go:335-337`) → `MaximumBlockSize` silently falls back to
  `params.MaximumBlockSizes[0]`, which may differ from live consensus.
- Empty `params.MaximumBlockSizes` → `params.MaximumBlockSizes[0]` panics
  (no bounds check at `explorerroutes.go:2154`). **INFERRED** — relies on the
  node always populating this; true for known nets.

---

## Section 7 — Common Pitfalls

- Adding a template row and putting the computed value in `commonData`
  ("it's convenient") — pollutes every page. Use `ExtendedParams`.
- Assuming `BlockchainInfo` is always present → forgetting the nil fallback,
  or removing it and crashing on non-tip / RPC-warn states.
- Reading `pageData.BlockchainInfo` without `RLock` — silent data race.
- "Multi-coin-ifying" the subsidy rows — these are VAR consensus params, not a
  per-coin map; the page is intentionally VAR-only.
- Adding a new network without extending the hardcoded `AddressPrefixes`
  tables → address section silently blank.
- Expecting param edits at the node to appear without restarting the explorer
  (`exp.ChainParams` is captured once).

---

## Section 8 — Evidence

- Route: `cmd/dcrdata/main.go:810`
- Handler: `cmd/dcrdata/internal/explorer/explorerroutes.go:2143-2184`
- `commonData`: `explorerroutes.go:2534-2572`
- `AddressPrefixes`: `explorer/types/explorertypes.go:1508-1549`
- ChainParams capture: `cmd/dcrdata/internal/explorer/explorer.go:369-371`
- `pageData` struct: `explorer.go:230-233`
- `Store` (writes `BlockchainInfo`): `explorer.go:536-572` (assignment `:572`)
- `StoreMPData` (other reader): `explorer.go:504-506`
- RPC source / tip-nil gate: `blockdata/blockdata.go:38,332-357` (`:339-341`)
- `GetChainParams`: `db/dcrpg/pgblockchain.go:6408-6410`
- `GetTip`: `db/dcrpg/pgblockchain.go:7319-7348`
- ETag middleware: `cmd/dcrdata/internal/explorer/explorermiddleware.go:193`
- Template: `cmd/dcrdata/views/parameters.tmpl` (rows e.g.
  `:9,30,41,61,119-168,173`)

---

## See also

- `wiki/code-analysis/page-rendering/patterns.md`
  (shares-pattern-with: out-of-band shared page state; `*CommonPageData`
  embedding; shared-state lock discipline; block-scoped ETag cache)
- `wiki/code-analysis/page-rendering/impact.md`
  (depends-on: `commonData` nil render crash)
- `wiki/core/staking-rewards.md`
  (depends-on: VAR subsidy/reward proportion semantics)
- `REWARDS_LOGIC.md`
  (depends-on: multi-coin reward model — why this page stays VAR-only)
