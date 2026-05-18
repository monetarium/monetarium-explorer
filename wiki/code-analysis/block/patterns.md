# Block Domain Patterns

## 1. Dual Data Pipeline Pattern

Block data flows through two independent pipelines:

- UI/API pipeline → via `blockdata.BlockData`
- Database pipeline → via `wire.MsgBlock` → `dbtypes.MsgBlockToDBBlock`

These pipelines:

- duplicate logic
- do NOT share computed results
- can diverge independently

Implication:
See [core/constraints.md#C2](../../core/constraints.md#C2)

---

## 2. Map → Slice Transformation Pattern

Backend representation:

- `map[uint8]string` (coinType → amount)

Frontend representation:

- `[]PoWSKAReward` (sorted array)

Transformation happens in:

- `explorerUI.Store`
- `PubSubHub.Store`

Implication:

- Maps are not exposed to frontend
- Ordering must be explicitly enforced via sorting

---

## 3. String-Based High Precision Pattern

All SKA values:

- computed using `big.Int`
- stored as `string`
- transferred as raw integer strings (atoms)

No float or decimal representation is used before frontend.

Implication:
See [core/constraints.md#C1](../../core/constraints.md#C1)

---

## 4. Template + WebSocket Synchronization Pattern

Two independent rendering paths:

1. Server-side:
   - `explorerUI` → `HomeInfo` → Go templates

2. Client-side:
   - `PubSubHub` → JSON → WebSocket → Stimulus controllers

Both must produce identical structures.

In this domain the parity is **not** complete: REST exposes `map[uint8]string` while WebSocket emits sorted arrays — a concrete instance of dual-transport shape asymmetry.

Implication:
See [core/constraints.md#C3](../../core/constraints.md#C3) and [core/constraints.md#C8](../../core/constraints.md#C8)

---

## 5. Manual Fan-Out Pattern

`BlockDataSaver` distributes data to multiple consumers:

- `ChainDB`
- `explorerUI`
- `PubSubHub`

Each consumer:

- processes data independently
- applies its own transformations

Implication:

- No shared transformation layer
- High duplication risk

---

See also:

- /wiki/code-analysis/page-rendering/impact.md (depends-on: "Saver Writer/Reader Drift" — `(*ChainDB).Store` is one of the fan-out `BlockDataSaver`s; a one-sided saver change desyncs HTML vs WebSocket).
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: out-of-band shared page state populated by the same block saver fan-out).
- /wiki/core/constraints.md#C2 (depends-on: dual pipeline mutation — DB `MsgBlockToDBBlock` vs UI `BlockData` recompute independently), #C8 (shares-pattern-with: dual-transport shape asymmetry — REST `map[uint8]string` vs WS sorted arrays).
