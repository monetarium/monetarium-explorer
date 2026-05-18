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

## Risk: Silent Blank Address-Prefix Table

**Trigger:**
The active network's `params.Name` is not `"mainnet"`, does not start with
`"testnet"`, and is not `"simnet"` (a new/renamed network, a custom regtest
name).

**Failure mode:** silent (HTTP 200, missing section).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§5 network-name coupling)

**Description:**
`types.AddressPrefixes(params)` hits the final `else { return nil }`
([explorer/types/explorertypes.go:1549](../../../explorer/types/explorertypes.go#L1549)).
The handler assigns this `nil` straight into
`ExtendedParams.AddressPrefix`
([explorerroutes.go:2146,2171](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L2146))
with no error check. The template ranges over an empty slice → the entire
address-prefix table renders blank while the page returns 200 OK. A new
network requires extending **all three** hardcoded prefix arrays
([:1536-1538](../../../explorer/types/explorertypes.go#L1536)) and the
selection switch ([:1540-1550](../../../explorer/types/explorertypes.go#L1540));
forgetting any one silently drops the section. (Note: flow.full.md cites this
function at `:1508-1549`; it is actually `:1516-1559`, **+8 line drift**, nil
return still at `:1549`.)

---

## Risk: Misaligned Address-Prefix Rows

**Trigger:**
Adding or removing an address kind by editing only some of the four parallel
slices in `AddressPrefixes` (`Descriptions`, `Name`, and the three
`<Net>Prefixes`).

**Failure mode:** silent (HTTP 200, wrong prefix/name pairing).

**Affected flows:**

- /wiki/code-analysis/parameters/flow.full.md (§6 direct dependencies)

**Description:**
The build loop zips the slices by positional index:
`AddrPrefix{Name: Name[i], Description: desc, Prefix: netPrefixes[i]}`
([explorer/types/explorertypes.go:1552-1559](../../../explorer/types/explorertypes.go#L1552)).
There is no length assertion across the four slices. An off-by-one (e.g.
adding a description without the matching `Name` and prefix entries) silently
pairs the wrong prefix string with the wrong field name; if the prefix slice
is *shorter* than `Descriptions`, `netPrefixes[i]` panics at request time
(loud) instead. All four slices must be edited at the same index.

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
- [ ] Touching `AddressPrefixes` → all four parallel slices
      (`Descriptions`, `Name`, `Mainnet/Testnet/SimnetPrefixes`) edited at the
      same index; selection switch covers any new `params.Name`.
- [ ] `BlockchainInfo != nil` branch and the `MaximumBlockSizes[0]` fallback
      preserved together; new params variant populates `MaximumBlockSizes`.
- [ ] Any new `pageData` field read is inside an `RLock()`/`RUnlock()` window;
      no code holds `invsMtx` then waits on `pageData.Lock` (deadlocks against
      `Store` — see page-rendering impact).
- [ ] No SKA / per-coin value injected into the VAR-only subsidy rows; new
      amount rows are VAR via `amountAsDecimalParts`
      (see [core/constraints.md#C1](../../core/constraints.md#C1)).
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
