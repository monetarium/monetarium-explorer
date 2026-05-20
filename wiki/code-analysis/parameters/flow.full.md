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

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:2144-2186`
- **Data structures:** anonymous `struct{ *CommonPageData; ExtendedParams }`;
  `ExtendedParams{ MaximumBlockSize int64; ActualTicketPoolSize int64; AddressPrefix []types.AddrPrefix; SKACoins []types.SKACoinParam }`
- **Transformations:**
  - `addrPrefix := types.AddressPrefixes(params)`
  - `actualTicketPoolSize := int64(params.TicketPoolSize * params.TicketsPerBlock)`
  - `maxBlockSize`: under `pageData.RLock()`, `BlockchainInfo.MaxBlockSize` if
    non-nil, else `int64(params.MaximumBlockSizes[0])` (`:2150-2156`)
  - `SKACoins := buildSKACoinParams(params)` — walks `params.SKACoins` in
    `CoinType` order, cross-references `params.InitialSKATypes`, and
    pre-formats all 18-decimal SKA atom amounts (`MaxSupply`,
    `MinRelayTxFee`, `EmissionAmounts[]`) to plain decimal strings via
    `formatAtomsAsCoinString` so no `*big.Int` crosses the template
    boundary (`cmd/dcrdata/internal/explorer/parameters.go`).

### commonData (shared header)

- **Location:** `explorerroutes.go:2534-2572`
- **Data structures:** `*CommonPageData{ Tip, Version, ChainParams, BlockTimeUnix, NetName, … }`
- **Transformations:** `GetTip(ctx)` → `exptypes.WebBasicBlock` (Postgres,
  `db/dcrpg/pgblockchain.go:7319-7348`). On error logs and **returns `nil`**
  (`:2540`). Re-injects `exp.ChainParams` and
  `BlockTimeUnix = int64(exp.ChainParams.TargetTimePerBlock.Seconds())`.

### AddressPrefixes transform

- **Location:** `explorer/types/explorertypes.go` (function plus
  `addrPrefixSet` per-net tables for mainnet / testnet* / simnet / regnet).
- **Data structures:** `[]AddrPrefix{ Name, Prefix, Description }`
- **Transformations:** picks the per-net `addrPrefixSet` by `params.Name`
  (Monetarium values: mainnet `Mk Ms Me MS Mc Pm dprv dpub`, testnet `Tk Ts
  Te TS Tc Pt tprv tpub`, simnet `Sk Ss Se SS Sc Ps sprv spub`, regnet `Rk
  Rs Re RS Rc Pr rprv rpub`). For any other `params.Name` the function
  **does not return nil** — it falls back to the magic-byte hex
  representation of each `chaincfg.Params` ID field so the table is never
  silently empty. Description / Name columns are produced inline per row
  (no parallel slices to keep aligned).

### SKACoinParams transform

- **Location:** `cmd/dcrdata/internal/explorer/parameters.go`
  (`buildSKACoinParams`, `formatBigIntAsSKAString`, `formatBigIntWithCommas`).
- **Data structures:** `[]types.SKACoinParam` (defined in
  `explorer/types/explorertypes.go`; view-model: pre-formatted strings only,
  no `*big.Int`).
- **Transformations:** sort `params.SKACoins` by `cointype.CoinType`,
  cross-reference `params.InitialSKATypes` for the `InitiallyActive` flag,
  and pre-format every 18-decimal SKA atom value via
  `formatAtomsAsCoinString(s, uint8(cointype.CoinTypeMax), 0)` — exact
  `big.Int` division, no rounding, no scientific notation, thousands
  commas. `AtomsPerCoin` is rendered as a plain comma-separated integer
  scale (e.g. `1,000,000,000,000,000,000`). `EmissionKey` is deliberately
  omitted (spec §9 — dev-stub).

### Template

- **Location:** `cmd/dcrdata/views/parameters.tmpl`
- **Data structures:** consumes `.ChainParams.*` (~35 rows) from the embedded
  `CommonPageData`, and
  `.ExtendedParams.{MaximumBlockSize,ActualTicketPoolSize,AddressPrefix,SKACoins}`.
  No Treasury section, no `BlockTaxProportion` row — Monetarium has no
  treasury. PoW/PoS subsidy rows render `.ChainParams.WorkRewardProportionV2` /
  `.ChainParams.StakeRewardProportionV2` (the actual 50% / 50% fields), not the
  legacy 60 / 30 fields.
- **Transformations:** template helpers `amountAsDecimalParts`,
  `durationToShortDurationString`, `uint16Mul`. The SKA coin section renders
  the pre-formatted strings from `ExtendedParams.SKACoins` directly — no
  formatter helper invoked in-template for SKA amounts, ensuring the
  `*big.Int → string` precision contract is enforced at the handler boundary.

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
- **Subsidy/Stake rows stay VAR-only scalar:** `BaseSubsidy`,
  `WorkRewardProportionV2`, `StakeRewardProportionV2`, `MinimumStakeDiff`,
  etc. are scalar `chaincfg.Params` fields and use the VAR 8-decimal
  `amountAsDecimalParts` / `float64` path. Do **not** multi-coin-ify them
  into per-coin maps — these are VAR consensus constants (see
  `REWARDS_LOGIC.md`). The new SKA section is the only multi-coin content on
  the page; it lives in its own table.
- **SKA precision boundary:** every 18-decimal SKA atom value on this page
  must be pre-formatted to a plain decimal string in the handler
  (`buildSKACoinParams` via `formatAtomsAsCoinString`). Never pass `*big.Int`
  or atom integers into the template — they exceed `float64` precision and
  break the spec §9 "no rounding, no scientific notation" contract
  ([core/constraints.md#C1](../../core/constraints.md#C1)).
- **Static for process lifetime:** `exp.ChainParams` is never refreshed after
  startup; a node config change requires an explorer restart to reflect here.
- **Network-name coupling (soft):** `AddressPrefixes` picks documented
  textual prefixes per `params.Name` (`mainnet`/`testnet*`/`simnet`/`regnet`)
  and falls back to the magic-byte hex for any other name. The table is
  never silently empty; adding a new recognised net means extending the
  `addrPrefixSet` table, not avoiding a crash.
- **Cache is block-scoped & intentional:** served under
  `ETagAndLastModifiedIntercept`; ETag/Last-Modified reset on new block/mempool.
  Stale-looking content between blocks is expected (only `MaxBlockSize` moves).

---

## Section 6 — Mutation Impact

When modifying `/parameters` data, check:

**Direct dependencies**

- `parameters.tmpl` field names must exist on `*chaincfg.Params` (via
  `.ChainParams`) or on `ExtendedParams` (`explorerroutes.go:2158-2164`).
- `AddressPrefixes` callers: only `ParametersPage` (`explorerroutes.go:2146`).
  Adding a new address kind = one row inline in the literal; adding a new
  recognised network = one entry in `lookupAddrPrefixSet` plus the
  corresponding `addrPrefixSet` var. There are no longer any parallel
  slices to keep index-aligned.
- `buildSKACoinParams` callers: only `ParametersPage`
  (`explorerroutes.go:2173`). The `types.SKACoinParam` shape is consumed by
  `parameters.tmpl` only — changing a field name there means updating both
  the type and the template.

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

- `BlockchainInfo == nil` (between blocks, or RPC warn-and-continue at
  `blockdata.go:335-337`) → `MaximumBlockSize` silently falls back to
  `params.MaximumBlockSizes[0]`, which may differ from live consensus.
- Empty `params.MaximumBlockSizes` → `params.MaximumBlockSizes[0]` panics
  (no bounds check at `explorerroutes.go:2154`). **INFERRED** — relies on the
  node always populating this; true for known nets.
- (Eliminated) Unrecognised `params.Name` no longer produces a silent blank
  address-prefix table — `AddressPrefixes` now falls back to a magic-byte
  hex representation. Prefix textual values for an unrecognised net will be
  hex (`0x1fc5` etc.) rather than the documented two-letter form, but the
  rows are present.
- (Eliminated) `AddressPrefixes` no longer uses parallel slices —
  misaligned-row bug class is gone. New address kinds are added as inline
  literal rows.

---

## Section 7 — Common Pitfalls

- Adding a template row and putting the computed value in `commonData`
  ("it's convenient") — pollutes every page. Use `ExtendedParams`.
- Assuming `BlockchainInfo` is always present → forgetting the nil fallback,
  or removing it and crashing on non-tip / RPC-warn states.
- Reading `pageData.BlockchainInfo` without `RLock` — silent data race.
- "Multi-coin-ifying" the subsidy rows — these are VAR consensus params, not a
  per-coin map; the page is intentionally VAR-only.
- Adding a new recognised network without extending `lookupAddrPrefixSet` +
  the corresponding `addrPrefixSet` var → address section shows magic-byte
  hex instead of the documented two-letter prefixes (degrades gracefully,
  but still less informative than the per-net table).
- Passing a `*big.Int` or atom integer directly into the SKA section of the
  template instead of going through `buildSKACoinParams` →
  precision loss / scientific notation in the rendered amount, violating
  spec §9.
- Expecting param edits at the node to appear without restarting the explorer
  (`exp.ChainParams` is captured once).

---

## Section 8 — Evidence

- Route: `cmd/dcrdata/main.go:810`
- Handler: `cmd/dcrdata/internal/explorer/explorerroutes.go:2143-2186`
- `commonData`: `explorerroutes.go:2534-2572`
- `AddressPrefixes` (+ per-net `addrPrefixSet` table):
  `explorer/types/explorertypes.go`
- `SKACoinParam` view-model: `explorer/types/explorertypes.go`
- `buildSKACoinParams` (+ `formatBigIntAsSKAString`,
  `formatBigIntWithCommas`): `cmd/dcrdata/internal/explorer/parameters.go`
- ChainParams capture: `cmd/dcrdata/internal/explorer/explorer.go:369-371`
- `pageData` struct: `explorer.go:230-233`
- `Store` (writes `BlockchainInfo`): `explorer.go:536-572` (assignment `:572`)
- `StoreMPData` (other reader): `explorer.go:504-506`
- RPC source / tip-nil gate: `blockdata/blockdata.go:38,332-357` (`:339-341`)
- `GetChainParams`: `db/dcrpg/pgblockchain.go:6408-6410`
- `GetTip`: `db/dcrpg/pgblockchain.go:7319-7348`
- ETag middleware: `cmd/dcrdata/internal/explorer/explorermiddleware.go:193`
- Template: `cmd/dcrdata/views/parameters.tmpl` (Chain / Subsidy / Stake /
  Rule-change / Address / SKA coin sections)
- V2 reward proportion fields on chaincfg:
  `github.com/monetarium/monetarium-node/chaincfg` `params.go:517-535`
- `SKACoinConfig` + `SKACoins` + `InitialSKATypes`:
  `github.com/monetarium/monetarium-node/chaincfg` `params.go:249-305,759,764`

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
