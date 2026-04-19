### 9. Compact Knowledge (LLM-Optimized)

- **One-line Flow:** `wire.MsgBlock` → segregated `int64` (VAR) / `*big.Int` string (SKA) → Postgres (`INT8` / `TEXT`) → Go Templates/API String → Stimulus JS `BigInt` + `<template>` DOM chunk ingestion.
- **Key Architectural Patterns:**
  - **Complete Numeric Bifurcation:** Core DB and backend separate VAR operations (`int64`) from SKA operations (`math/big` objects).
  - **String-Only Storage & API:** To protect the unique 33-digit scale of SKA allocations, DB values travel exclusively as base-10 `TEXT` and JSON Strings.
  - **Dual-State Clone Rendering:** UI state uses Go `.tmpl` initially, with real-time websocket updates intercepting JS `BigInt` text nodes to clone completely separated `<template>` chunks, bypassing all front-end innerHTML templates.
- **Critical Constraints:**
  - You MUST strictly NEVER cast SKA Strings to `float64`, PostgreSQL `FLOAT`, or JS `Number` to avert instant catastrophic precision truncation.
  - Front-end math operations on SKA _must_ rely on custom `splitSkaAtoms` array splicing and `BigInt` equivalents.
- **Mutation Checklist:**
  - [ ] Adjust scaling logic within `templates.go` (`skaDecimalParts`).
  - [ ] Ensure formatting boundaries match string rules within `ska_helper.js` (`splitSkaAtoms`).
  - [ ] Manually verify mapping logic between standard HTML nodes & inner hidden `<template>` ids in `*.tmpl` files.
  - [ ] Update JS controller DOM bindings (`mining_controller.js` etc.) if layout shifts.
