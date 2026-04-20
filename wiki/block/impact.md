# Block Domain – Mutation Impact

## When modifying: BlockData or block-related logic

You MUST verify all of the following layers.

---

## 1. Direct Consumers

### explorerUI

- File: `explorer.go`
- Risk: compile-time break if structure changes
- Dependency: `map[uint8]string` → slice conversion

### PubSubHub

- File: `pubsubhub.go`
- Risk: compile-time break + WebSocket payload mismatch
- Dependency: same transformation logic as explorerUI

---

## 2. Frontend Dependencies

### Stimulus Controllers

- Files: `mining_controller.js`, `supply_controller.js`
- Expect:
  - array format
  - raw integer strings

Risk:

- NaN errors
- broken DOM updates

---

## 3. Serialization Boundaries

### REST API

- File: `api/apiroutes.go`
- Format: map-based JSON

### WebSocket API

- File: `pubsubhub.go`
- Format: array-based JSON

Risk:

- breaking one interface but not the other

---

## 4. Database Layer (Critical Divergence)

### ChainDB

- File: `pgblockchain.go`

### Conversion

- File: `dbtypes/conversion.go`

Important:

- DOES NOT use `BlockData`
- recalculates everything from `wire.MsgBlock`

Risk:

- UI and DB diverge silently

---

## 5. Loud Failures

These will break immediately:

- Changing `map[uint8]string` → different type
- Changing struct fields used in:
  - `explorerUI`
  - `PubSubHub`
- Breaking `wire.MsgBlock` assumptions

---

## 6. Silent Failures (High Risk)

### Precision corruption

- converting SKA to float/int
- formatting values before frontend

### UI inconsistencies

- mismatch between:
  - server templates
  - WebSocket updates

### DB vs UI divergence

- changing Collector logic only

---

## 7. Safe Change Checklist

Before committing changes:

- [ ] explorerUI updated
- [ ] PubSubHub updated
- [ ] frontend controllers verified
- [ ] API responses checked (REST + WS)
- [ ] DB logic reviewed (`dbtypes`)
- [ ] no precision loss introduced
