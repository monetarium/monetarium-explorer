chaincfg.Params (static, launch-time) ──► ChainDB.chainParams ──► exp.ChainParams
RPC GetBlockChainInfo (per block, tip-only) ──► blockdata ──► pageData.BlockchainInfo
GET /parameters → ETag cache → ParametersPage → {CommonPageData + ExtendedParams} → parameters.tmpl

Key Patterns:

- **Near-static page:** only `MaximumBlockSize` is dynamic; rest is immutable `chaincfg.Params`
- **Dual param injection:** template merges `.ChainParams` (commonData) + `.ExtendedParams` (handler) via struct embedding
- **`exp.ChainParams` captured once at startup** — node config change needs explorer restart
- **Block-scoped ETag cache** (`ETagAndLastModifiedIntercept`) — intentional
- **VAR scalar subsidy rows + dedicated SKA section:** subsidy/stake rows are VAR scalar `chaincfg.Params` fields; the SKA coin parameters table is the only multi-coin content, fed by a pre-formatted view-model
- **`WorkRewardProportionV2` / `StakeRewardProportionV2`** are the actual 50/50 fields read by the template (not the legacy V1 60/30 fields, and not the deprecated `WorkSubsidyProportion()` helper which still returns V1)

Critical Constraints:

- Read `pageData.BlockchainInfo` only under `RLock` (writer `Store` holds `Lock`)
- `BlockchainInfo` is `nil` for non-tip blocks by design → handler falls back to `params.MaximumBlockSizes[0]`
- VAR-only subsidy/stake rows: scalar `chaincfg.Params`, NOT per-coin maps (see REWARDS_LOGIC.md). SKA coins live only in the SKA section.
- `AddressPrefixes` returns documented per-net textual prefixes for mainnet/testnet*/simnet/regnet and falls back to magic-byte hex for any other `params.Name` — never returns `nil`.
- SKA atom values (`MaxSupply`, `MinRelayTxFee`, `EmissionAmounts`) MUST be pre-formatted server-side via `formatAtomsAsCoinString`; no `*big.Int` crosses the template boundary.
- `commonData` is shared by ALL pages; page-specific data → `ExtendedParams`

Mutation Checklist:

- new template row → put computed value in `ExtendedParams`, never `commonData`
- changing `BlockchainInfo`/`Store` → also affects home page + `StoreMPData`
- changing `GetChainParams`/`commonData` → affects every page
- new address-prefix kind → add an inline literal row inside `AddressPrefixes`; new recognised network → add an `addrPrefixSet` var and a case in `lookupAddrPrefixSet`
- new SKA field on the page → extend `types.SKACoinParam` AND `buildSKACoinParams` AND the template; SKA atom values must go through `formatAtomsAsCoinString` (or `formatBigIntAsSKAString`)
- preserve the `BlockchainInfo == nil` fallback

Silent Risks:

- `BlockchainInfo == nil` → `MaxBlockSize` silently uses stale `MaximumBlockSizes[0]`
- empty `MaximumBlockSizes` → index panic (no bounds check) [INFERRED]
- bypassing `buildSKACoinParams` and rendering a SKA `*big.Int` directly → precision loss / scientific notation

Hard Failures:

- template exec error / `commonData` nil (DB down) → `StatusPage(ExpStatusError)`

See also:
- code-analysis/block/flow.compact.md (shares-pattern-with: pageData RWMutex + blockdata.Store fan-out)
- code-analysis/mempool/flow.compact.md (shares-pattern-with: ETag block-scoped caching)
- core/staking-rewards.md (depends-on: VAR subsidy/reward proportions)
