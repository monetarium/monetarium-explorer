# Parameters Page — Data Flow (Full)

> Code-grounded trace of `/parameters`. Verified at branch `feat/address-page`.
> The page is **mostly static chain config**; dynamic content is
> `MaximumBlockSize` (tip-only RPC), the shared `commonData` header, and —
> for non-initial SKA coins — the runtime-derived `Active` / `Pending`
> status sourced from on-chain emission state.

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
    Postgres ──► SKACoinSupply (emitted CoinTypes) ──► dataSource ◄────────┤
                 + SKACoinEmissionHeights (batch)                          │
                                                                          │
   GET /parameters ──► ETagAndLastModifiedIntercept ──► ParametersPage ◄──┘
                                                          │
                    ┌─────────────────────────────────────┤
                    │ commonData(r): GetTip() [Postgres]   │ derive ExtendedParams
                    │   + exp.ChainParams                   │   + AddressPrefixes(params)
                    │                                      │   + emissionHeights{} (PG)
                    │                                      │   + buildSKACoinParams(...)
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
  - `emissionHeights map[uint8]int64` is built per request: call
    `exp.dataSource.SKACoinSupply(ctx)` for the list of CoinTypes ever
    observed on chain, gather those not in `params.InitialSKATypes` into a
    slice, then call `exp.dataSource.SKACoinEmissionHeights(ctx, nonInitial)`
    — a single `GROUP BY coin_type` query — to learn the first main-chain
    block height for each. Both
    queries are **non-fatal**: on error the map is empty / partial and the
    handler falls back to the static `Active` flag (graceful degradation,
    see Section 5).
  - `SKACoins := buildSKACoinParams(params, exp.Height(), emissionHeights)` —
    walks `params.SKACoins` in `CoinType` order, cross-references
    `params.InitialSKATypes`, and pre-formats all 18-decimal SKA atom
    amounts (`MaxSupply`, `MinRelayTxFee`, `EmissionAmounts[]`) to plain
    decimal strings via `formatAtomsAsCoinString` so no `*big.Int` crosses
    the template boundary (`cmd/dcrdata/internal/explorer/parameters.go`).
    For each non-InitiallyActive coin observed in `emissionHeights`, the
    static `Active` flag is overridden against the chain tip — see SKA
    runtime status below.

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
- **Signature:** `buildSKACoinParams(params *chaincfg.Params, chainHeight int64, emissionHeights map[uint8]int64) []types.SKACoinParam`.
  `chainHeight` is the tip height (`exp.Height()`); `emissionHeights` maps
  CoinTypes that have been observed on chain to their first main-chain
  block height. Nil / empty `emissionHeights` is valid — the function falls
  back to the static `Active` flag for every coin.
- **Data structures:** `[]types.SKACoinParam` (defined in
  `explorer/types/explorertypes.go`; view-model: pre-formatted strings only,
  no `*big.Int`). Status-bearing fields: `Active`, `InitiallyActive`,
  `Pending`.
- **Transformations:** sort `params.SKACoins` by `cointype.CoinType`,
  cross-reference `params.InitialSKATypes` for the `InitiallyActive` flag,
  and pre-format every 18-decimal SKA atom value via
  `formatAtomsAsCoinString(s, uint8(cointype.CoinTypeMax), 0)` — exact
  `big.Int` division, no rounding, no scientific notation, thousands
  commas. `AtomsPerCoin` is rendered as a plain comma-separated integer
  scale (e.g. `1,000,000,000,000,000,000`). `EmissionKey` is deliberately
  omitted (spec §9 — dev-stub).

#### SKA runtime status — `Active` override + `Pending`

For coins **not** in `InitialSKATypes` and **only** when `chainHeight >= 0`,
`buildSKACoinParams` overrides the static `SKACoinConfig.Active` flag with
on-chain emission state:

| Condition                                            | Effective `Active` | `Pending` |
| ---------------------------------------------------- | ------------------ | --------- |
| Not present in `emissionHeights` (never emitted)     | static `c.Active`  | false     |
| Present, `chainHeight < firstHeight + CoinbaseMaturity` | **false**       | **true**  |
| Present, `chainHeight >= firstHeight + CoinbaseMaturity` | **true**        | false     |

Notes:

- The override is **one-way**: it can flip a static `Active: false` to
  effective true (post-maturity) and a static `Active: true` to effective
  false (still maturing). Mid-period, `Pending=true` always implies
  effective `Active=false` — they are not independent.
- `InitiallyActive` coins (SKA1 on every net) skip the override entirely.
  Their static `Active` is the truth — they were live at genesis, no
  maturation period to model.
- The maturity gate uses `params.CoinbaseMaturity`. SKA emissions are
  emission-class transactions gated by an agenda vote
  (`activateska{n}` in `internal/blockchain/ska_emission.go`), not
  literal coinbase tx; the coinbase-maturity number is reused here as the
  "settle for reorg safety" window. If node-side emission-tx maturity ever
  diverges from `CoinbaseMaturity`, this gate must move with it.

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

#### SKA per-coin header badge (4-state, order-sensitive)

`parameters.tmpl:329` picks at most one badge per coin via a single
`{{if}}{{else if}}{{else if}}{{end}}` chain. The order matters because
`Pending=true` always coincides with effective `Active=false`; without
`Pending` being checked first, a maturing coin would render as `inactive`.

```gotemplate
{{if $coin.Pending}}<span class="badge bg-warning ms-2 fs12">pending</span>
{{else if not $coin.Active}}<span class="badge bg-secondary ms-2 fs12">inactive</span>
{{else if not $coin.InitiallyActive}}<span class="badge bg-info ms-2 fs12">activated post-genesis</span>{{end}}
```

| `Pending` | effective `Active` | `InitiallyActive` | Badge                       |
| --------- | ------------------ | ----------------- | --------------------------- |
| true      | false              | *                 | **pending** (yellow)        |
| false     | false              | *                 | **inactive** (grey)         |
| false     | true               | true              | (none — normal coin)        |
| false     | true               | false             | **activated post-genesis** (blue) |

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
- **`SKACoinParam.Active` is runtime-effective for non-initial coins:**
  the visible `Active` value on `/parameters` is *not* the raw
  `SKACoinConfig.Active` flag for coins outside `InitialSKATypes`. It is
  derived from `SKACoinSupply` + `SKACoinEmissionHeights` against
  `exp.Height()` and `params.CoinbaseMaturity`. Anyone reading "is SKA{n}
  active?" off the page is reading on-chain truth via this derivation,
  not the genesis-config flag. The static flag is the silent fallback if
  the Postgres queries fail.
- **`exp.Height() < 0` (unsynced) disables the override.** While the
  explorer is not yet synced past the chain tip, `chainHeight` may be
  negative; `buildSKACoinParams` skips the override in that window so the
  page falls back to the static `Active` flag rather than mislabel coins
  using a half-built `emissionHeights` map.
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
- `SKACoinParam.Pending` consumers: only the badge cascade at
  `parameters.tmpl:329`. Adding a new status state (e.g. `expired`) means
  changing four places at once: the chain.io / agenda-tracker source of
  truth, the override logic in `buildSKACoinParams`, the field on
  `SKACoinParam`, and the badge chain in the template (where new branches
  must be inserted in the correct priority order — `Pending` precedes
  `Active` for the same reason a new state must precede whichever existing
  state it visually overrides).
- `SKACoinEmissionHeights` callers: only `ParametersPage` (one batch
  query). Single `GROUP BY coin_type` query against the `vouts`/`transactions`
  join; cost does not scale with the number of observed coin types.

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
- Treating `SKACoinParam.Active` as a static mirror of
  `chaincfg.SKACoinConfig.Active` for non-initial coins. It is the
  **runtime-effective** value derived from on-chain emission state and the
  `CoinbaseMaturity` window. Reading it as "what the node config says" will
  be wrong for any SKA{n>=2} that's been emitted, and reading "is this coin
  available?" off the static flag will mislead during the maturation
  period.
- Reordering the badge `{{if}}{{else if}}{{else if}}{{end}}` chain at
  `parameters.tmpl:329` without realising `Pending=true` always coincides
  with effective `Active=false`. The current order — `Pending` → `not
  Active` → `not InitiallyActive` — is load-bearing: if `Pending` is not
  checked first, a maturing coin will silently render as `inactive` rather
  than `pending`.
- Adding a new SKA coin status state (e.g. `expired`, `paused`) without
  inserting its badge branch in the correct priority order, or without
  reflecting it in `buildSKACoinParams` runtime derivation. Both halves
  must move together — a new field on `SKACoinParam` that is never set, or
  a new badge branch that's masked by an earlier `{{else if}}`, are both
  silent-failure modes.
- Calling `SKACoinEmissionHeights` without being aware it is a batch
  `GROUP BY` query (already optimal — no N+1, but the return type
  `map[uint8]int64` removes the per-coin `(ok bool)` signal that the
  singular method provided).

---

## Section 8 — Evidence

- Route: `cmd/dcrdata/main.go:810`
- Handler: `cmd/dcrdata/internal/explorer/explorerroutes.go:2143-2186`
- `commonData`: `explorerroutes.go:2534-2572`
- `AddressPrefixes` (+ per-net `addrPrefixSet` table):
  `explorer/types/explorertypes.go`
- `SKACoinParam` view-model (incl. `Pending` and `Active` semantics):
  `explorer/types/explorertypes.go`
- `buildSKACoinParams` (+ `formatBigIntAsSKAString`,
  `formatBigIntWithCommas`) and the runtime override / `Pending`
  computation: `cmd/dcrdata/internal/explorer/parameters.go`
- `emissionHeights` map construction in handler:
  `cmd/dcrdata/internal/explorer/explorerroutes.go` `ParametersPage`
- `explorerDataSource.SKACoinEmissionHeights` interface entry:
  `cmd/dcrdata/internal/explorer/explorer.go`
- Postgres backing: `ChainDB.SKACoinEmissionHeights`
  (`db/dcrpg/pgblockchain.go`) + `SelectSKACoinEmissionHeights` SQL
  (`db/dcrpg/internal/vinoutstmts.go`)
- SKA per-coin badge cascade: `cmd/dcrdata/views/parameters.tmpl:329`
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
