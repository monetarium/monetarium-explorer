### 1. Overview

Tracing the dual-token end-to-end data lifecycle of VAR (primary) and SKA (custom token) values. The analysis maps exact conversions from their initial atomic Monetarium RPC state to scaled real-time display, highlighting the distinct numerical precision strategies used to prevent silent high-precision truncation across PostgreSQL, the Go backend, and UI Stimulus controllers.

### 2. End-to-End Data Flow

`wire.MsgBlock` ingest → `dbtypes.conversion` (segregates VAR `int64` / SKA `*big.Int`) → `db/dcrpg` (persists VAR as `INT8`, SKA as `TEXT`) → `templates.go` (scales tokens via `math/big`) → Historic HTML (`.tmpl`) OR Real-time JSON API Payload → Stimulus JS (`ska_helper.js` string/`BigInt` processing) → `<template>` node injection in DOM.

### 3. Per-Layer Breakdown

- **Location:** `db/dbtypes/conversion.go` (RPC Ingestion)
  - **Data Structures Involved:** `varTotal int64`, `skaTotal map[uint8]*big.Int`
  - **Transformations Applied:** Early bifurcation. Loops through `tx.TxOut`, distinguishing tokens via `out.CoinType.IsSKA()`. Accumulates VAR natively and SKA using `new(big.Int).Add`.

- **Location:** `db/dcrpg/internal/vinoutstmts.go` (Persistence Layer)
  - **Data Structures Involved:** PostgreSQL schemas (`vins` and `vouts`)
  - **Transformations Applied:** Standard VAR stays `value INT8`. Massive precision SKA is strictly cast to `ska_value TEXT`. No SQL math or numeric schema rounding takes place.

- **Location:** `cmd/dcrdata/internal/explorer/templates.go` (Scaling / API Layer)
  - **Data Structures Involved:** Go `math/big`
  - **Transformations Applied:** Uses scaling coefficients: `varDecimals = big.NewInt(1e8)` and `skaDecimals = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)`. Divides atomic amounts via `new(big.Int).Div` to obtain proper fraction strings (`skaDecimalParts`, `formatCoinAtomsFull`) just prior to injection into the API boundary.

- **Location:** `cmd/dcrdata/public/js/helpers/ska_helper.js` and `mining_controller.js` (Frontend Representation)
  - **Data Structures Involved:** Native JS `BigInt` and DOM `<template id="...">`
  - **Transformations Applied:** Avoids `Number` to prevent 15-digit precision loss. Slices base-10 strings logically into `intPart`, `bold`, `rest`, and `trailingZeros` for CSS greying. Replaces DOM elements explicitly using `document.importNode(tmpl.content, true)`.

### 4. Cross-Layer Dependencies

- **String Formatting Protocol Coupling:** The string chopping rules in backend Go templates (`skaSplitParts` / `skaDecimalParts`) are tightly coupled to the exact slicing mechanisms in the client side (`splitSkaAtoms` and `splitSkaValue`). Altering display digits (e.g. bolding 3 decimals instead of 2) requires synchronized updates across both JS and Go borders.
- **WebSocket to DOM `<template>:`** The JSON structure broadcasted from PubSubHub (`r.amount` string) strictly expects the historic `.tmpl` HTML to contain an inert, identical `<template>` tag. If either deviates visually, real-time rendering breaks parity.

### 5. Critical Constraints

- **Absolute Precision Safety Boundary:** SKA payload structures must perpetually traverse the DB and API as strings (`ska_value TEXT`). They can never be cast to native float64 or JS `Number` at any tier.
- **JS Native Number Prohibition:** The UI _must_ use `BigInt("value") / BigInt("1000000000000000000")` or isolated string manipulation when scaling raw atomic updates.

### 6. Mutation Impact

When modifying token precision, scaling math, or display format, you MUST check ALL of the following:

- Direct dependencies: The API JSON payload serialization structure (where the SKA string is built).
- Indirect dependencies: `cointype.IsSKA()` ingestion limits.
- Serialization boundaries: PostgreSQL schemas (should you migrate from TEXT).
- Rendering layers: Both `*.tmpl` files AND `<template>` element blocks injected by `_controller.js` modules.

- **What will silently break:** Passing SKA values into standard UI formatting helpers like `humanize_helper.js` via `parseFloat()`, causing invisible truncation after 15/16 decimal digits.
- **What will fail loudly:** Modifying the IDs or CSS classes of the embedded HTML `<template>` rows without simultaneously updating the Stimulus JS controllers' `querySelector` targeting.

### 7. Common Pitfalls

- Storing real-time token math properties natively as JSON variables instead of string maps (`r.amount = 1.000` vs `"1.000"`).
- Trying to build repeating live-update token HTML nodes manually using JS string literals instead of the `<template>` deep-cloning paradigm.
- Assuming VAR (`1e8`) and SKA (`1e18`) atomic lengths share the same big limit logic in the Go backend.

### 8. Evidence

- **RPC separation:** `db/dbtypes/conversion.go` (Lines 18-45, `blockCoinAmounts`).
- **Database Schema Storage:** `db/dcrpg/internal/vinoutstmts.go` (Line ~18-30: `value INT8`, `ska_value TEXT`).
- **Formatter Constants:** `cmd/dcrdata/internal/explorer/templates.go` (Lines ~310-312: `skaDecimals` declaration).
- **Client-Side Strings:** `cmd/dcrdata/public/js/helpers/ska_helper.js` (Line ~21-46: `splitSkaAtoms` uses `BigInt(atomStr)` and string splicing).
- **Live Render Parity:** `cmd/dcrdata/public/js/controllers/mining_controller.js` (Line ~55-70: `<template>` selection and `splitSkaAtoms` injection).

---
