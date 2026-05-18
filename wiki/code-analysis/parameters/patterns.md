# Parameters Domain Patterns

Recurring patterns and invariants specific to the `/parameters` page. The
shared server-page mechanics (`*CommonPageData` struct-embedding injection,
out-of-band `pageData` reads, `pageData.RWMutex` lock discipline, block-scoped
ETag cache) are **not** re-described here — they are consolidated in
`/wiki/code-analysis/page-rendering/patterns.md`; this domain links out via
`shares-pattern-with`. Below are only the parameters-specific behaviors.

---

## Near-Static Config Page (One Dynamic Field)

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§1, §5)

**Description:**
`/parameters` is ~95% an immutable read of `chaincfg.Params`. The handler reads
nothing live except a single dynamic value: `MaximumBlockSize`. `params :=
exp.ChainParams` is the process-lifetime snapshot captured once at startup
([explorer.go:369-371](../../../cmd/dcrdata/internal/explorer/explorer.go#L369-L371)),
and ~40 template rows bind straight off `.ChainParams.*`. The only
request-time variation comes from `exp.pageData.BlockchainInfo.MaxBlockSize`
([explorerroutes.go:2149-2156](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2149-L2156)),
itself a per-block out-of-band snapshot, not a live RPC call.

**Constraints:**

- `exp.ChainParams` is never refreshed; a node consensus-config change is
  invisible here until the explorer process restarts. Do not "fix" this with a
  per-request refresh — the page contract is "static for process lifetime".
- Only add a *dynamic* row if its source is already in `pageData` (written by
  `Store`); the handler has no other live data source and is registered under
  `withCache` (see page-rendering ETag pattern), so per-request-varying output
  would serve stale bytes between blocks.

---

## Dual-Source Param Split (`commonData` vs `ExtendedParams`)

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§4, §6)

**Description:**
The template payload is `struct{ *CommonPageData; ExtendedParams }`
([explorerroutes.go:2164-2174](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2164-L2174)).
This is the generic `*CommonPageData` embedding pattern, but parameters is the
trace that grounds the **split decision**: ~40 rows resolve via
`.ChainParams.*` (owned by `commonData`, shared by every page) and exactly
three resolve via `.ExtendedParams.*` — `MaximumBlockSize`,
`ActualTicketPoolSize`, `AddressPrefix` — a *page-local anonymous struct type*
declared inside the handler
([explorerroutes.go:2158-2162](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2158-L2162)).
`ActualTicketPoolSize = int64(params.TicketPoolSize * params.TicketsPerBlock)`
([explorerroutes.go:2147](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2147))
is a derived value that is *not* a `chaincfg.Params` field — it must live in
`ExtendedParams` precisely because there is no common-struct field for it.

**Constraints:**

- A new computed/derived row belongs in the handler's `ExtendedParams` struct,
  never in `commonData` (changing `commonData` touches every page — see
  page-rendering `impact.md` → *commonData Nil Render Crash*).
- A new row that *is* a raw `chaincfg.Params` field needs no handler change —
  add the template `.ChainParams.X` directly; the field is already in scope via
  embedding.
- `ExtendedParams` is an anonymous struct redeclared inside the handler body;
  there is no exported type to reuse. Adding a field is a same-function edit in
  two places (the `type` block and the literal).

---

## Hardcoded Network-Name Address-Prefix Table

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§3, §5, §7)

**Description:**
`types.AddressPrefixes(params)`
([explorer/types/explorertypes.go:1516-1559](../../../explorer/types/explorertypes.go#L1516)
— flow.full.md cites `:1508-1549`; the function is actually at `:1516`,
**+8 line drift**) builds the address-prefix table from **four parallel
index-aligned slices**: `Descriptions` and `Name`
([:1517-1534](../../../explorer/types/explorertypes.go#L1517)) plus one of
three hardcoded prefix arrays — `MainnetPrefixes` / `TestnetPrefixes` /
`SimnetPrefixes`
([:1536-1538](../../../explorer/types/explorertypes.go#L1536)). Selection is a
literal string switch on `params.Name`: `== "mainnet"`,
`strings.HasPrefix(name, "testnet")`, `== "simnet"`, else **`return nil`**
([:1540-1550](../../../explorer/types/explorertypes.go#L1540)). The only caller
is `ParametersPage`
([explorerroutes.go:2146](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2146))
— blast radius is one page.

**Constraints:**

- The four slices (`Descriptions`, `Name`, `<Net>Prefixes`) are zipped by
  positional index in the build loop
  ([:1552-1559](../../../explorer/types/explorertypes.go#L1552)). Adding/removing
  an address kind requires editing **all four** slices at the same index, or
  rows misalign (wrong prefix paired with wrong name) with no error.
- A new network whose `params.Name` is not `mainnet`/`testnet*`/`simnet`
  returns `nil` → the address section renders blank with HTTP 200 (see
  `impact.md` → *Silent Blank Address-Prefix Table*).

---

## VAR-Only Consensus-Param Rows

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§5, §7)

**Description:**
The subsidy/reward rows — `BaseSubsidy`
([parameters.tmpl:117-119](../../../cmd/dcrdata/views/parameters.tmpl)),
`MulSubsidy`/`DivSubsidy`/`SubsidyReductionInterval` (`:126-136`),
`WorkRewardProportion`/`StakeRewardProportion`/`BlockTaxProportion`
(`:140-151`, rendered via `{{uint16Mul .ChainParams.X 10}}%`), and
`MinimumStakeDiff` (`:167-168`, hardcoded `VAR` literal in the template) — are
**scalar `chaincfg.Params` fields**, not per-coin maps. `BaseSubsidy` and
`MinimumStakeDiff` go through `amountAsDecimalParts` (VAR's 8-decimal
`float64` path). SKA coins are deliberately absent: these are VAR consensus
constants, and the multi-coin reward model (see `REWARDS_LOGIC.md`) does not
parameterize them per coin.

**Constraints:**

- Do not "multi-coin-ify" these rows into per-coin maps; they are not a
  `map[uint8]...` anywhere in the param model. The page is intentionally
  VAR-only.
- Any new amount row sourced from `chaincfg.Params` is VAR and may use
  `amountAsDecimalParts` (float64-safe at 8 decimals). A SKA-denominated value
  would violate the precision split — see
  [core/constraints.md#C1](../../core/constraints.md#C1) — and has no
  `chaincfg.Params` source anyway.

---

## No-Bounds-Check `MaximumBlockSizes[0]` Fallback

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§5, §6)

**Description:**
When `exp.pageData.BlockchainInfo == nil` (non-tip state by design at
[blockdata/blockdata.go:339-341](../../../blockdata/blockdata.go#L339-L341),
or the RPC warn-and-continue at
[blockdata/blockdata.go:334-337](../../../blockdata/blockdata.go#L334-L337)),
the handler falls back to `int64(params.MaximumBlockSizes[0])`
([explorerroutes.go:2154](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2154)).
There is **no length check** on the `MaximumBlockSizes` slice and no
non-nil-guard short-circuit beyond the `BlockchainInfo != nil` branch. This
fallback is load-bearing: it is the *intended* behavior for every render
between blocks, not an edge case.

**Constraints:**

- Preserve the `BlockchainInfo != nil` branch and the `[0]` fallback together;
  removing the fallback crashes on every non-tip / RPC-warn render, not rarely.
- The fallback value can differ from live consensus `MaxBlockSize` — that
  divergence is silent and accepted (see `impact.md`). Do not add an error path
  for it.
- The unchecked `[0]` index panics on an empty `MaximumBlockSizes` slice
  ([INFERRED] — relies on the node always populating it; true for known nets,
  see `impact.md` → *Empty `MaximumBlockSizes` Index Panic*).

---

See also:

- /wiki/code-analysis/page-rendering/patterns.md
  (shares-pattern-with: `*CommonPageData` struct-embedding template injection;
  out-of-band shared `pageData` reads; `pageData.RWMutex` lock discipline;
  block-scoped ETag/Last-Modified page cache)
- /wiki/code-analysis/parameters/impact.md
  (the mutation risks these patterns produce)
- /wiki/core/constraints.md#C1
  (depends-on: VAR/SKA numeric precision bifurcation — why the subsidy rows
  stay VAR scalar)
