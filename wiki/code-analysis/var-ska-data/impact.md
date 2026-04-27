# VAR & SKA Data Mutation Impact

Based on the architectural patterns tracing the dual-token VAR and SKA behaviors, precision logic must traverse bifurcated pathways to remain safe. This document maps exactly how changes to token formats or scaling propagate throughout the system.

## Propagation Layers

When a multi-token calculation or presentation logic is modified, the change must be verified across the following disconnected layers:

1. **RPC Ingestion Layer**: `db/dbtypes/conversion.go` separating `cointype.IsSKA()` values into `*big.Int` from the raw `wire.MsgBlock`.
2. **Persistence Layer**: `db/dcrpg/internal/vinoutstmts.go` saving exact limits via `INT8` (VAR) and `TEXT` (SKA).
3. **Go Interpolation Layer**: `cmd/dcrdata/internal/explorer/templates.go` handling server-side mathematical division without floats (e.g., `skaDecimalParts` using `new(big.Int).Exp`).
4. **Static UI Presentation Layer**: `cmd/dcrdata/views/home_mining.tmpl` binding the Go function helpers to render the initial load exactly once.
5. **Client-side Parsing**: `cmd/dcrdata/public/js/helpers/ska_helper.js` manually mimicking Go's token string manipulations (via `splitSkaAtoms` and `BigInt()`).
6. **Dynamic JS Presentation Layer**: `cmd/dcrdata/public/js/controllers/mining_controller.js` handling Websocket events and injecting the customized string parts into inert `<template>` fragments.

## Failure Modes

### 💥 Loud Failures (Compile errors or JS crashes)

- **File:** `db/dcrpg/internal/vinoutstmts.go`
  - **Risk:** Coercing `ska_value` to `NUMERIC` without verifying Postgres constraints and Go SQL driver mapping creates immediate schema errors during `vin`/`vout` insertions.
- **File:** `cmd/dcrdata/views/home_mining.tmpl` (interacting with `mining_controller.js`)
  - **Risk:** If you alter or remove an ID property like `id="pow-ska-reward-template"`, the Stimulus controller's `document.getElementById` search fails loudly, breaking incoming real-time block rendering.
- **File:** `db/dbtypes/conversion.go`
  - **Risk:** Modifying the root `map[uint8]string` footprint of `blockCoinAmounts` will loudly break memory references of consuming PubSub listeners and core explorer models.

### 🔕 Silent Failures (Data Loss or UX Breaks)

- **File:** `cmd/dcrdata/internal/explorer/templates.go` vs. `cmd/dcrdata/public/js/helpers/ska_helper.js`
  - **Risk:** The Formatting Parity Drift. If you modify `skaDecimalParts` in Go to trim trailing zeroes differently, but you do not update `splitSkaAtoms()` in JS identically, the website will load initially with one formatting layout, and silently jump to a different format once WebSockets push a new block.
- **File:** `cmd/dcrdata/public/js/controllers/mining_controller.js`
  - **Risk:** Primitive Number Coercions. Wrapping `r.amount` via Javascript's `parseFloat()` or Native `Number()` silently drops the payload down to 15 significant digits of precision, irrevocably losing the final decimal fractions of SKA values with no errors thrown.

---

## Safe-Change Checklist

Before concluding any structural mutation involving VAR or SKA tokens, verify the following:

- [ ] **Ingestion Safety:** Modifications correctly bifurcate at `out.CoinType.IsSKA()` inside `dbtypes/conversion.go` without forcing the two tokens into a shared numeric struct type.
- [ ] **Persistent String Safety:** High-precision SKA values rigidly traverse PostgreSQL schema bounds (`TEXT`), the Pubsub JSON payload, and backend structs strictly as base-10 strings or `*big.Int` pointers.
- [ ] **Dual-Environment Formatting:** Trimming, bolding, and decimal logic applied within Go server-side helpers (`templates.go`) has been replicated symmetrically inside Javascript utilities (`ska_helper.js`).
- [ ] **Template Synchronization:** Static rendering blocks explicitly match the CSS class hierarchy found inside the corresponding hidden `<template id="...">` DOM fragments.
- [ ] **JS Runtime Safety:** WebSockets payloads are shielded against JS runtime precision clipping by processing atom scaling exclusively through `BigInt()` abstractions.
