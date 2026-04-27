RPC → Notifier → ChainMonitor → Collector → BlockData → BlockDataSaver
→ [ChainDB (MsgBlock) | explorerUI (HomeInfo) | PubSubHub (HomeInfo)]
→ [Templates | WebSocket → Stimulus JS]

Key Patterns:

- **Fan-out architecture** via BlockDataSaver (3 independent consumers)
- **Multi-source-of-truth:** Collector (UI path) ≠ dbtypes (DB path)
- **Duplication:** explorerUI ≈ PubSubHub (same map → array transformation)
- **API divergence:** REST (map) vs WebSocket (array)

Critical Constraints:

- SKA: `big.Int → string` (no float, no formatting before frontend)
- DB ignores `BlockData.ExtraInfo` (always recomputes from `wire.MsgBlock`)
- Frontend requires arrays (not maps) + stable ordering

Mutation Checklist:

- update `blockdata.Collector` (if logic changes)
- update `dbtypes.MsgBlockToDBBlock` (or DB/UI diverge)
- check `explorerUI.Store`
- check `PubSubHub.Store`
- verify REST vs WebSocket schemas
- verify template vs WebSocket consistency
- verify JS parsing (`amount` must remain raw string → otherwise NaN)

Silent Risks:

- changing Collector → affects UI only (DB stays old)
- formatting numbers on backend → breaks JS parsing

Loud Failures:

- changing `map[uint8]string` → breaks explorer + pubsub
- changing `wire.MsgBlock` → breaks ingestion + DB
