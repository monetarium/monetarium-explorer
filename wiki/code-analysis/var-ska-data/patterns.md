### 1. Late-Stage Precision Scaling

- **Implication for mutation:** You must defer all mathematical scaling, decimal shifting, and formatting logic until the absolute final boundary of the system (i.e., API serialization or template injection). If you attempt to mutate, aggregate, or cast these values using native primitive schemas mid-pipeline—or if you prematurely convert them out of their exact base-10 string wrappers—you will trigger silent, irreversible data truncation.

### 2. Symmetrical Presentation Ecosystems

- **Implication for mutation:** The presentation tier is completely decoupled but aggressively overlaps. Any structural, formatting, or data-binding modification to a UI component demands identical, mirrored mutations across two isolated environments (the server-rendered markup and the client-side cloning mechanisms). If you only update one, the UI will exhibit visual corruption the moment a real-time event overwrites the static page state.

### 3. Terminal Perimeter Flattening

- **Implication for mutation:** Deeply nested analytical contexts and hierarchical backend mapping structures do not survive transmission to real-time clients. If you want to expose a new piece of nested data, you cannot simply attach it to the parent struct; you must actively mutate the fan-out serialization boundaries to explicitly "squash" and sort it into the flat arrays that the clients blindly consume.

### 4. Bifurcated State Ingestion

- **Implication for mutation:** The system inherently derives its truth from the node's raw data via two entirely segregated pipelines (historical heavy-persistence vs. lightweight real-time broadcasting). When introducing a new domain concept or altering how an existing value is aggregated, you must actively engineer the change into both ingestion pathways. Overlooking one leads to a fractured state where real-time indicators conflict with the historical database record.

### 5. Centralized Coin Type Label Rendering

Coin type labels (`VAR`, `SKA1`–`SKA255`) are produced by dedicated functions at each rendering boundary. The mapping is: `0 → "VAR"`, `1–255 → "SKA{n}"`. There are two canonical implementations — one per environment — and they must stay in sync:

| Environment               | Location                                      | Function                                                                                                 |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Go templates (SSR)        | `cmd/dcrdata/internal/explorer/templates.go`  | `coinSymbol(ct uint8) string` — registered as `coinSymbol` in the template `FuncMap`                     |
| JS / Stimulus (real-time) | `cmd/dcrdata/public/js/helpers/ska_helper.js` | `renderCoinType(coinType: number): string` — handles `null`/`undefined`/out-of-range with `"-"` fallback |

Related JS helpers in `ska_helper.js` and `humanize_helper.js` that operate on coin values (not labels):

- `formatCoinAtoms(atomStr, coinType)` — formats a raw atom string to three significant figures; routes to VAR (8 decimals) or SKA (18 decimals) path based on `coinType`
- `formatCoinAtomsFull(atomStr, coinType)` — same routing, full precision with trailing zeros stripped
- `splitSkaAtoms(atomStr)` — splits a raw SKA atom string into display parts (`intPart`, `bold`, `rest`, `trailingZeros`) using BigInt to avoid float64 loss

- **Implication for mutation:** Never construct coin type labels inline (e.g. `` `SKA${n}` `` or hardcoded `"VAR"` strings). Always call the canonical function for the environment you are in. If the label format ever changes, both `coinSymbol` and `renderCoinType` must be updated together. If you add a new formatting helper for coin values, add it to `ska_helper.js` or `humanize_helper.js` — not inline in a controller.
