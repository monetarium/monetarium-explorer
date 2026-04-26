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
See [system/constraints.md#C2](../system/constraints.md#C2)

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
See [system/constraints.md#C1](../system/constraints.md#C1)

---

## 4. Template + WebSocket Synchronization Pattern

Two independent rendering paths:

1. Server-side:
   - `explorerUI` → `HomeInfo` → Go templates

2. Client-side:
   - `PubSubHub` → JSON → WebSocket → Stimulus controllers

Both must produce identical structures.

Implication:
See [system/constraints.md#C3](../system/constraints.md#C3)

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
