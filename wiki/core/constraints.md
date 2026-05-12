# System-Wide Constraints

## C1: Numeric Precision & Bifurcation (applies to: block, tx, frontend)

The system bifurcates how it handles numerical precision for its tokens.
Token limits & handling:

- **VAR** (8 integer digits, 8 decimal places): Calculated using standard Go `int64` and float logic, and stored natively as `INT8` in PostgreSQL.
- **SKA** (15 integer digits, 18 decimal places): Computed using the specialized Go `math/big` arithmetic module to prevent bounds overflow and precision loss.
  Because SKA values exceed native `float64` limits, SKA values MUST be stored, transferred, and presented across boundaries (DB schema `TEXT`, APIs, WebSockets) strictly as base-10 `string` types. Using primitive floating-point types for SKA at any tier (including JS `Number`) will inherently drop atomic precision (maxing out at ~15 digits) or trigger scientific notation. Client-side math must rely on JS `BigInt` or manual string chopping.

## C2: Dual Pipeline Mutation (applies to: block, tx)

The system bifurcates how it determines truth for pending vs. historical states. Real-time pipelines (Mempool, Websockets) rely on internal Go-memory helpers (`txhelpers`, `blockdata.Collector`), while static pipelines (DB, API) rely heavily on node RPC JSON mapping (`dbtypes.MsgBlockToDBBlock`, `GetRawTransactionVerbose`). Any change in data fields or calculations MUST be applied symmetrically to both independent pipelines to prevent silent state divergence when items confirm.

## C3: Template + WebSocket Parity (applies to: block, tx, frontend)

There is a strict presentation layer schism. Static data uses server-side Go `html/template` generation (e.g. `tx.tmpl`), while real-time data uses client-side Stimulus JS. Any field added, changed, or fixed must be mirrored identically across both mechanisms; otherwise, live pushed states will aggressively overwrite static page state with incongruous UX elements.

## C4: Perimeter Flattening & Array Stability (applies to: tx, pubsub)

To optimize system and wire performance, complex structural data arrays (e.g., heavily nested `Vin` and `Vout` transaction slices) are actively "flattened" or "squashed" by the ingestion layer. While internal Go components and REST APIs might use root-level summary maps for this (e.g., `map[uint8]string`), the WebSocket broadcast layer (PubSubHub) MUST transform these maps into sorted arrays before sending. The frontend heavily relies on array types for stable ordering when iterating over cloned DOM `<template>` elements. Deep transactional or analytical context inherently perishes before hitting the WebSocket broadcast wire, but the structure reaching the Javascript layer must be a stable array, not a map.

## C5: CSS Styling Patterns (applies to: frontend)

Prioritize existing SCSS variables and Bootstrap utility classes/components. Never use hard-coded (inline) values. If a required value is missing, define a new SCSS variable in the global variables file using the project's naming convention, then reference it. Avoid creating custom CSS if a combination of Bootstrap utilities can achieve the same result.

## C6: In-DOM Template Cloning (applies to: frontend)

Javascript MUST use `document.importNode(tmpl.content, true)` to clone inert `<template id="...">` elements when rendering live data. NEVER build ad-hoc HTML strings in JS (e.g., via `innerHTML` concatenation or template literals). This prevents XSS, segregates markup from logic, and ensures live-updated elements correctly leverage the identical SCSS rules utilized by the server-rendered templates (supporting C3).

## C7: Centralized Coin-Type Label Rendering (applies to: block, tx, charts, mempool, address, frontend)

Coin-type labels (`VAR`, `SKA1`–`SKA255`) must be produced through the canonical helper for each environment, never inline. The mapping is `0 → "VAR"`, `1–255 → "SKA{n}"`.

| Environment               | Location                                      | Function                                                                                                     |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Go templates (SSR)        | `cmd/dcrdata/internal/explorer/templates.go`  | `coinSymbol(ct uint8) string` — registered as `coinSymbol` in the template `FuncMap`                         |
| JS / Stimulus (real-time) | `cmd/dcrdata/public/js/helpers/ska_helper.js` | `renderCoinType(coinType: number): string` — handles `null` / `undefined` / out-of-range with `"-"` fallback |

Related JS helpers in `ska_helper.js` and `humanize_helper.js` operate on coin amounts (not labels): `formatCoinAtoms(atomStr, coinType)` (three-significant-figure routing by coin type), `formatAtomsAsCoinString(atomStr, coinType)` (full precision, trimmed trailing zeros), and `splitSkaAtoms(atomStr)` (`BigInt`-safe display-part splitting; supports C1).

Rules:

- Never construct labels inline (`` `SKA${n}` ``, hardcoded `"VAR"`, etc.). Always call the canonical function for the environment.
- If the label format ever changes, update both `coinSymbol` and `renderCoinType` in the same change.
- New formatting helpers for coin amounts go in `ska_helper.js` / `humanize_helper.js`, not in a controller.

## C8: Dual-Transport Shape Asymmetry (applies to: block, transaction, visualblocks, mempool, frontend)

C3 (parity) covers the *ideal*: a logical entity should be reproducible identically by template and WebSocket. C8 covers the *reality*: across several pages, the same logical entity travels in **different on-the-wire shapes** depending on transport, and the frontend must reconcile them. Pattern-Clone (C3) and Perimeter Flattening (C4) describe the symptoms; C8 names the concrete asymmetries that already exist and *must not silently drift further*.

**Concrete manifestations:**

- **Block** (REST vs WebSocket multi-coin amounts):
  REST `/api/block/...` exposes `map[uint8]string` (`{"0":"...","1":"..."}`) derived from `BlockData.ExtraInfo`. WebSocket `pubsubhub` flattens the same maps into sorted `[]PoWSKAReward`-style arrays. The JS controllers require arrays; REST consumers tolerate maps. The transformation is duplicated in `explorerUI.Store` and `pubsub/pubsubhub.go.Store`. *See:* [/wiki/code-analysis/block/flow.full.md](../code-analysis/block/flow.full.md) §4.
- **Transaction** (mempool aggregation vs confirmed array):
  Mempool path squashes outputs into a single per-coin total (`MempoolTx.SKATotals map[uint8]string`) at ingestion via `txhelpers.SKATotalsFromMsgTx`. Confirmed path keeps the full `Vout` array verbatim from `dcrd`'s `GetRawTransactionVerbose` and exposes `apitypes.Vout[i].CoinType` / `SKAValue`. The JS mempool controller and the Go `tx.tmpl` template each handle only their respective shape; cross-cutting features must reconcile both. *See:* [/wiki/code-analysis/transaction/flow.full.md](../code-analysis/transaction/flow.full.md) §2, §9.
- **VisualBlocks** (HTTP trim vs WebSocket full BlockInfo):
  HTTP handler trims `*BlockInfo → *TrimmedBlockInfo` (drops Treasury/StakeFees, applies `FilterRegularTx` to remove coinbase, renames `block.Tx` → `Transactions`). WebSocket `sigNewBlock` emits the full `BlockInfo` (field name `Tx`, includes coinbase). `visualBlocks_controller.js._handleVisualBlocksUpdate` re-implements `FilterRegularTx` client-side (`block.Tx.filter(!Coinbase)`). Additionally, `Subsidy` is `BlockSubsidy{Dev}` for the mempool tile and `chainjson.GetBlockSubsidyResult{Developer}` for block tiles — both names appear in one template. *See:* [/wiki/code-analysis/visualblocks/flow.full.md](../code-analysis/visualblocks/flow.full.md) §4.

**Rules wherever this pattern appears:**

- Treat HTTP and WebSocket shapes as **two independent contracts**, not one. A change to a Go struct used on one path does not automatically reach the other.
- Any logical field added to a server-rendered template must also be added to the WebSocket payload AND to the JS controller that consumes it — otherwise newly arriving entities silently miss the field while initial-render entities show it.
- Any client-side reconciliation logic (filter, aggregate, map→array) is **load-bearing duplicate code** mirroring a backend transform. Update both sides together.
- When two paths use different Go types for the "same" concept (e.g. `BlockSubsidy.Dev` vs `chainjson.GetBlockSubsidyResult.Developer`), document the mapping at the JS/template boundary; do not paper over it with one-sided renames.

**Common failure mode:** Backend struct gets a new field. The HTTP handler is updated and the template renders the field. The next new block arrives via WebSocket, the JS re-renders that tile, and the field is missing. The page looks correct on initial load and silently broken on update — a class of bug that does not show up in `go build` or `go test`, only in live behavior.
