chaincfg.Params (static, launch-time) ──► ChainDB.chainParams ──► exp.ChainParams
RPC GetBlockChainInfo (per block, tip-only) ──► blockdata ──► pageData.BlockchainInfo
GET /parameters → ETag cache → ParametersPage → {CommonPageData + ExtendedParams} → parameters.tmpl

Key Patterns:

- **~95% static page:** only `MaximumBlockSize` is dynamic; rest is immutable `chaincfg.Params`
- **Dual param injection:** template merges `.ChainParams` (commonData) + `.ExtendedParams` (handler) via struct embedding
- **`exp.ChainParams` captured once at startup** — node config change needs explorer restart
- **Block-scoped ETag cache** (`ETagAndLastModifiedIntercept`) — intentional

Critical Constraints:

- Read `pageData.BlockchainInfo` only under `RLock` (writer `Store` holds `Lock`)
- `BlockchainInfo` is `nil` for non-tip blocks by design → handler falls back to `params.MaximumBlockSizes[0]`
- VAR-only page: subsidy/reward rows are scalar `chaincfg.Params`, NOT per-coin maps (see REWARDS_LOGIC.md)
- `AddressPrefixes` hardcoded to mainnet/testnet*/simnet → `nil` otherwise
- `commonData` is shared by ALL pages; page-specific data → `ExtendedParams`

Mutation Checklist:

- new template row → put computed value in `ExtendedParams`, never `commonData`
- changing `BlockchainInfo`/`Store` → also affects home page + `StoreMPData`
- changing `GetChainParams`/`commonData` → affects every page
- keep `AddressPrefixes` Name/Descriptions/prefix arrays index-aligned
- preserve the `BlockchainInfo == nil` fallback

Silent Risks:

- unknown `params.Name` → empty address-prefix table, no error
- `BlockchainInfo == nil` → `MaxBlockSize` silently uses stale `MaximumBlockSizes[0]`
- empty `MaximumBlockSizes` → index panic (no bounds check) [INFERRED]

Hard Failures:

- template exec error / `commonData` nil (DB down) → `StatusPage(ExpStatusError)`

See also:
- code-analysis/block/flow.compact.md (shares-pattern-with: pageData RWMutex + blockdata.Store fan-out)
- code-analysis/mempool/flow.compact.md (shares-pattern-with: ETag block-scoped caching)
- core/staking-rewards.md (depends-on: VAR subsidy/reward proportions)
