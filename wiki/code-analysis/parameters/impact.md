# Parameters Domain — Mutation Impact

## When modifying: the `/parameters` page or its backing config

Most of this page is an immutable read of `chaincfg.Params`, so the blast
radius is small — but the shared injection path is not isolated. Cross-domain
risks (`commonData` nil render crash, saver writer/reader drift, lock-order
inversion) are consolidated in
`/wiki/code-analysis/page-rendering/impact.md`; this page links out via
`depends-on`. Below are only the **parameters-specific** risks plus the one
shared risk this domain *grounds* concretely.

---

## Risk: `commonData` Nil → `.ChainParams` Deref → Error Page

**Trigger:**
`exp.dataSource.GetTip(ctx)` fails inside `exp.commonData(r)` (DB down,
migration, tip query error). `commonData` logs and returns `nil`
([explorerroutes.go:2537-2541](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2537-L2541)).

**Failure mode:** loud (HTTP error page).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (the concrete grounded path)

**Description:**
The `nil *CommonPageData` is still embedded in the
`struct{ *CommonPageData; ExtendedParams }` payload
([explorerroutes.go:2164-2174](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2164-L2174)).
`parameters.tmpl` dereferences `.ChainParams.*` on ~40 rows (first at
[parameters.tmpl:9](../../../cmd/dcrdata/views/parameters.tmpl) —
`{{.ChainParams.Name}}`), so template execution fails immediately → the
handler falls to
`StatusPage(defaultErrorCode, defaultErrorMessage, "", ExpStatusError)`
([explorerroutes.go:2176-2180](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2176-L2180)).
This is the parameters-grounded instance of the cross-domain *commonData Nil
Render Crash*: a single DB tip failure takes down every server-rendered page,
not just `/parameters`. See
`/wiki/code-analysis/page-rendering/impact.md` for the full blast-radius
analysis — do not add a parameters-local nil guard expecting it to fix the
class.

---

## Risk: Degraded (Hex) Address-Prefix Rows On Unrecognised Net

**Trigger:**
The active network's `params.Name` is not `"mainnet"`, does not start with
`"testnet"`, is not `"simnet"`, and is not `"regnet"` (a new/renamed
network, a custom dev-net name).

**Failure mode:** silent-but-visible (HTTP 200, rows present, prefixes
shown as `0x` + hex magic bytes instead of the documented two-letter form).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§3 AddressPrefixes transform)

**Description:**
`types.AddressPrefixes(params)` calls `lookupAddrPrefixSet(params.Name)`,
which returns `(zero, false)` for any unrecognised network name. The
function then renders each row with `"0x" + hex.EncodeToString(magic[:])`
as the `Prefix` cell. The rows are visible and informative (a custom net
operator can read the magic bytes), but they are no longer the documented
human-readable two-letter prefix. To restore the documented prefixes for a
new net, add an `addrPrefixSet` package var (with the textual prefixes
copied verbatim from the chaincfg comments) and a case in
`lookupAddrPrefixSet`.

**Eliminated risks (do not reintroduce):**

- Previously, an unrecognised net produced a silent blank section — that
  bug class is removed; the fallback ensures the rows are always present.
- Previously, the function zipped four parallel slices by index, so adding
  an address kind required four matching edits — that bug class is also
  removed; rows are now declared as inline struct literals.

---

## Risk: SKA `*big.Int` Crossing Template Boundary

**Trigger:**
A new SKA amount field is added to the page without routing it through
`buildSKACoinParams` / `formatBigIntAsSKAString` — e.g. exposing the
`*big.Int` directly on `types.SKACoinParam`, or rendering an atom integer
in the template.

**Failure mode:** silent (HTTP 200, wrong-but-plausible amount text).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§3 SKACoinParams transform,
  §5 SKA precision boundary)

**Description:**
SKA atoms are 18-decimal values that routinely exceed `float64`'s 15-17
significand digits. The existing VAR formatting path (`amountAsDecimalParts`
→ `float64`) silently loses precision and can serialise in scientific
notation for large values, both of which violate spec §9 ("show fully,
without rounding and without exponential notation"). The fix is structural:
`*big.Int` SKA values must be converted to plain decimal strings via
`formatAtomsAsCoinString` (or `formatBigIntAsSKAString`) at the handler
boundary, and the template must only see those pre-formatted strings.
`buildSKACoinParams` is the chokepoint; bypassing it is the failure path.

---

## Risk: Stale `MaximumBlockSize` Between Blocks

**Trigger:**
`exp.pageData.BlockchainInfo == nil` — the normal state for any non-tip render
([blockdata/blockdata.go:339-341](../../../blockdata/blockdata.go#L339-L341))
or when `GetBlockChainInfo` RPC warned-and-continued
([blockdata/blockdata.go:334-337](../../../blockdata/blockdata.go#L334-L337)).

**Failure mode:** silent (HTTP 200, possibly stale value).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§5, §6)

**Description:**
The handler falls back to `int64(params.MaximumBlockSizes[0])`
([explorerroutes.go:2154](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2154)),
the launch-time consensus default, which can differ from the node's current
`MaxBlockSize`. The page shows the fallback with no indication it is not live.
This is **intended** behavior (the page is block-scoped via `withCache`; only
`MaxBlockSize` moves between blocks) — do **not** add an error path. Removing
the fallback to "force fresh data" instead crashes every non-tip render.

---

## Risk: Empty `MaximumBlockSizes` Index Panic

**Trigger:**
`params.MaximumBlockSizes` is an empty slice while `BlockchainInfo == nil`.

**Failure mode:** loud (panic → 500 / dropped request).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§6 silent failures —
  flagged INFERRED)

**Description:**
`params.MaximumBlockSizes[0]`
([explorerroutes.go:2154](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2154))
has **no bounds check**. `[INFERRED]` — relies on `monetarium-node` always
populating this slice for known networks; true for mainnet/testnet/simnet but
not guaranteed for a custom params build. A custom `chaincfg.Params` with an
empty `MaximumBlockSizes` panics here on the first non-tip render. If you
introduce a new network/params variant, populate `MaximumBlockSizes` or add a
length guard alongside the existing nil check.

---

## Risk: Unlocked `pageData.BlockchainInfo` Read (Data Race)

**Trigger:**
New code reads `exp.pageData.BlockchainInfo` (or any `pageData` field) without
holding `pageData.RLock()`.

**Failure mode:** silent (data race; undefined behavior, torn pointer reads).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§5 lock discipline)

**Description:**
The handler correctly brackets its read in
`exp.pageData.RLock()` … `exp.pageData.RUnlock()`
([explorerroutes.go:2149-2156](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2149-L2156)),
while the background writer `(*explorerUI).Store` reassigns
`p.BlockchainInfo = blockData.BlockchainInfo` under `p.Lock()`
([explorer.go:568,572](../../../cmd/dcrdata/internal/explorer/explorer.go#L568-L572)).
Any new read of a `pageData` field added outside the existing RLock window
races against `Store` on every block. The same field is also read (correctly,
under RLock) by `StoreMPData`
([explorer.go:505-506](../../../cmd/dcrdata/internal/explorer/explorer.go#L505-L506))
— it is shared mutable state, not parameters-private. For the full multi-lock
map and the (loud) lock-order-inversion deadlock rule, see
`/wiki/code-analysis/page-rendering/impact.md` → *Lock-Order Inversion Against
`Store`* and page-rendering `patterns.md` → *Shared-State Lock Discipline*.

---

## Safe-Change Checklist

Before committing changes that touch the `/parameters` data path:

- [ ] New computed/derived row → put it in the handler's `ExtendedParams`
      struct (edit both the `type` block and the literal), never `commonData`.
- [ ] New raw-param row → `.ChainParams.X` in the template only; confirm `X`
      exists on `*chaincfg.Params`.
- [ ] Touching `AddressPrefixes` → new address kind = an inline struct
      literal row inside the function; new recognised network = a new
      `addrPrefixSet` var plus a case in `lookupAddrPrefixSet`.
- [ ] `BlockchainInfo != nil` branch and the `MaximumBlockSizes[0]` fallback
      preserved together; new params variant populates `MaximumBlockSizes`.
- [ ] Any new `pageData` field read is inside an `RLock()`/`RUnlock()` window;
      no code holds `invsMtx` then waits on `pageData.Lock` (deadlocks against
      `Store` — see page-rendering impact).
- [ ] No SKA / per-coin value injected into the VAR-only subsidy/stake
      rows; new SKA rows live only in the dedicated SKA coin section, with
      atom values pre-formatted via `formatAtomsAsCoinString` (or
      `formatBigIntAsSKAString`) at the handler boundary
      (see [core/constraints.md#C1](../../core/constraints.md#C1)).
- [ ] No Treasury content reintroduced — Monetarium has no treasury,
      `BlockTaxProportion` is always zero, the section was deliberately
      removed (spec §4).
- [ ] PoW/PoS subsidy rows continue to read
      `WorkRewardProportionV2`/`StakeRewardProportionV2`, not the legacy V1
      fields and not `WorkSubsidyProportion()`/`StakeSubsidyProportion()`
      (both return V1 = legacy 60/30).
- [ ] Handler stays a pure function of startup `ChainParams` + last-tick
      `pageData` (it is registered under `withCache`; per-request variation
      serves stale cached bytes).

---

See also:

- /wiki/code-analysis/parameters/patterns.md
  (the patterns these risks emerge from)
- /wiki/code-analysis/page-rendering/impact.md
  (depends-on: `commonData` Nil Render Crash — full blast radius; Lock-Order
  Inversion Against `Store`; Saver Writer/Reader Drift)
- /wiki/code-analysis/page-rendering/patterns.md
  (shares-pattern-with: shared-state lock discipline; block-scoped ETag cache)
- /wiki/core/constraints.md#C1
  (depends-on: VAR/SKA precision bifurcation — VAR-only subsidy rows)
