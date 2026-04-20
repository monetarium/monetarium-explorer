- **One-line Flow:**
  Mempool txs are decoded in Go (`txhelpers`) directly into aggregated string maps (`MempoolTx.SKATotals`), while Confirmed txs proxy Node RPC (`GetRawTransactionVerbose`) verbatim into array slices (`TxShort.Vout[]`).
- **Key Architectural Patterns:**
  1. **Structural Bifurcation:** Mempool relies on struct maps at the root level; Confirmed APIs rely on property injection on array slices.
  2. **Multi-Source of Truth:** Mempool calculates tokens internally; Confirmed logic trusts the Node.
  3. **Rendering Divergence:** Mempool relies on JS HTML `<template>` cloning; Confirmed relies on Go server-templates.
- **Critical Constraints:**
  - SKA `CoinType` and exact token amounts (`SKAValue`) MUST pass through the system as `string` or `*big.Int`. Never use legacy `float64` `Amount`.
  - The `tx.tmpl` view currently ignores token data and forces legacy float casting, requiring a template overwrite if accurate token rendering is needed.
- **Mutation Checklist:**
  - [ ] Did you update `apitypes.Vout` / `apitypes.TxShort` (Confirmed)?
  - [ ] Did you update `explorertypes.MempoolTx` (Unconfirmed)?
  - [ ] Are changes reflected in `homepage_controller.js` extraction?
  - [ ] Are changes reflected in `cmd/dcrdata/views/tx.tmpl` Go templates?
