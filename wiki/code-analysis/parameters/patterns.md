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
([explorer.go:339-341](../../../cmd/dcrdata/internal/explorer/explorer.go#L339-L341)),
and ~40 template rows bind straight off `.ChainParams.*`. The only
request-time variation comes from `exp.pageData.BlockchainInfo.MaxBlockSize`
([explorerroutes.go:1913-1920](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1913-L1920)),
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
([explorerroutes.go:1953-1964](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1953-L1964)).
This is the generic `*CommonPageData` embedding pattern, but parameters is the
trace that grounds the **split decision**: ~40 rows resolve via
`.ChainParams.*` (owned by `commonData`, shared by every page) and exactly
three resolve via `.ExtendedParams.*` — `MaximumBlockSize`,
`ActualTicketPoolSize`, `AddressPrefix` — a *page-local anonymous struct type*
declared inside the handler
([explorerroutes.go:1946-1951](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1946-L1951)).
`ActualTicketPoolSize = int64(params.TicketPoolSize * params.TicketsPerBlock)`
([explorerroutes.go:1911](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1911))
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

## Per-Net Address-Prefix Table With Magic-Byte Fallback

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§3, §5, §7)

**Description:**
`types.AddressPrefixes(params)`
([explorer/types/explorertypes.go](../../../explorer/types/explorertypes.go))
returns a `[]AddrPrefix` literal in which each row is declared inline: name,
description, and the textual base58 prefix for that address kind on the
active network. The prefix string comes from one of four package-level
`addrPrefixSet` constants — mainnet (`Mk Ms Me MS Mc Pm dprv dpub`), testnet
(`Tk Ts Te TS Tc Pt tprv tpub`), simnet (`Sk Ss Se SS Sc Ps sprv spub`),
regnet (`Rk Rs Re RS Rc Pr rprv rpub`) — selected by `params.Name` via
`lookupAddrPrefixSet`. For an **unrecognised** `params.Name` the function
falls back to a `0x` + hex.EncodeToString of the magic-byte field on
`chaincfg.Params`, so the rendered table is never silently empty. The only
caller is `ParametersPage` —
[explorerroutes.go:1910](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1910)
— blast radius is one page.

**Constraints:**

- Rows are an inline struct literal — no parallel slices to keep aligned.
  Adding a new address kind = one row inline in `AddressPrefixes`. There is
  no longer a bug class of misaligned rows.
- Adding a new **recognised** network requires both a new `addrPrefixSet`
  var with the documented per-net textual prefixes *and* a case in
  `lookupAddrPrefixSet`. Forgetting either means the new net falls into the
  magic-byte hex fallback — degraded display, but still non-empty.
- The textual prefix strings cannot be derived deterministically from the
  magic-byte fields alone: chaincfg's "starts with X" comments describe the
  typical real-world hash160 outcome, not a guarantee for arbitrary
  payloads. The hardcoded table is the source of truth.
- The `NetworkAddressPrefix` row remains a direct `.ChainParams` template
  read and is intentionally outside this function.

---

## VAR-Only Consensus-Param Rows + Dedicated SKA Section

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§5, §7)

**Description:**
The subsidy/stake rows — `BaseSubsidy`,
`MulSubsidy`/`DivSubsidy`/`SubsidyReductionInterval`,
`WorkRewardProportionV2`/`StakeRewardProportionV2` (rendered via
`{{uint16Mul .ChainParams.X 10}}%` to produce the actual 50% / 50% Monetarium
consensus split, not the legacy V1 60 / 30 fields), and `MinimumStakeDiff`
(hardcoded `VAR` unit in the template) — are **scalar `chaincfg.Params`
fields**, not per-coin maps. `BaseSubsidy` and `MinimumStakeDiff` go through
`amountAsDecimalParts` (VAR's 8-decimal `float64` path). SKA coins live
**only** in a dedicated section fed by `ExtendedParams.SKACoins`
(`[]types.SKACoinParam`, pre-formatted via `buildSKACoinParams`); they do
not parameterise the subsidy/stake rows. The legacy `BlockTaxProportion`
row is **absent** — Monetarium has no treasury.

**Constraints:**

- Do not "multi-coin-ify" the subsidy/stake rows. They are not a
  `map[uint8]...` in the param model, and Monetarium's per-coin behaviour
  is captured by the consensus rule `SSVMonetarium` (see
  `REWARDS_LOGIC.md`), not by per-coin subsidy parameters.
- Subsidy/stake amount rows are VAR (8 decimals, `float64`-safe) and use
  `amountAsDecimalParts`. SKA-denominated values do not appear in these
  rows.
- The SKA coin section is the page's only multi-coin content. Adding a new
  per-coin field there means extending `types.SKACoinParam` *and*
  `buildSKACoinParams` *and* the template — pre-format any SKA atom values
  via `formatAtomsAsCoinString` (or `formatBigIntAsSKAString`) so the
  template only sees plain strings (see
  [core/constraints.md#C1](../../core/constraints.md#C1)).

---

## Pre-Formatted SKA View-Model In `ExtendedParams`

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§3, §5)

**Description:**
SKA atom values on `chaincfg.SKACoinConfig` are `*big.Int` (`MaxSupply`,
`AtomsPerCoin`, `MinRelayTxFee`, `EmissionAmounts[]`) — they exceed
`float64` precision and cannot survive the existing VAR `amountAsDecimalParts`
path. `buildSKACoinParams`
([cmd/dcrdata/internal/explorer/parameters.go](../../../cmd/dcrdata/internal/explorer/parameters.go))
converts each `*big.Int` to a plain decimal string server-side, using
`formatAtomsAsCoinString` (exact `big.Int` division, no rounding, no
scientific notation, thousands commas) for coin amounts and a small
`formatBigIntWithCommas` helper for the atomic-scale `AtomsPerCoin` field.
The resulting `[]types.SKACoinParam` is consumed by the template as plain
strings — no `*big.Int` crosses the template boundary.

**Constraints:**

- Every new SKA amount-shaped field added to `SKACoinParam` must be
  formatted at the handler boundary; never expose a `*big.Int` or atom
  integer to the template.
- The `Label` field uses the canonical `SKA{n}` form (no dash), matching
  [core/product.md](../../core/product.md). Do not introduce a `SKA-{n}`
  variant — the `Symbol` field on `SKACoinConfig` is the dashed form for
  display alongside the label, not in place of it.
- The view-model must be a pure function of the startup-immutable
  `exp.ChainParams`; the builder reads no shared state and needs no lock.

---

## No-Bounds-Check `MaximumBlockSizes[0]` Fallback

**Appears in:**

- /wiki/code-analysis/parameters/flow.full.md (§5, §6)

**Description:**
When `exp.pageData.BlockchainInfo == nil` (non-tip state by design at
[blockdata/blockdata.go:338-340](../../../blockdata/blockdata.go#L338-L340),
or the RPC warn-and-continue at
[blockdata/blockdata.go:334-337](../../../blockdata/blockdata.go#L334-L337)),
the handler falls back to `int64(params.MaximumBlockSizes[0])`
([explorerroutes.go:1918](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L1918)).
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
