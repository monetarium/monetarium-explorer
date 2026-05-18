# Attack-Cost Page — Patterns

Domain-local patterns observed in this flow. These recur elsewhere in the wiki; global
normalization is left to a future `Consolidate:` pass.

## No-Compute Handler / Client-Side Math

**Description:** The Go handler performs **zero domain computation** — it copies a fixed
set of scalars from a shared snapshot into template `data-*` attributes; every attack
calculation (PoW device cost, electricity, PoS DCR-need, Decred hybrid deterrence formula,
projected ticket price) runs in `attackcost_controller.js`.

**Constraints:**
- All numeric correctness lives in JS `Number`; the Go side cannot enforce precision.
- Any value that must stay exact (SKA atoms) cannot pass through this pattern unchanged.
- Source: `explorerroutes.go:2693-2742`; `attackcost_controller.js:49-61, 503-611`.

## VAR-Only Legacy Snapshot

**Description:** Reads the legacy flat `HomeInfo.CoinSupply int64` / `TicketPoolInfo`
(`explorertypes.go:811,1375`) and never the multi-coin `VARCoinSupply`/`SKACoinSupply`.
All "DCR" labels are legacy VAR naming. Shared with `address/patterns.md`
("Legacy flat-field shim (residual)") — the address page retains the same
back-compat legacy flat VAR fields, though its template no longer reads them
(attack-cost still does, for `HomeInfo`).

**Constraints:**
- Treat "coin supply" / "DCR" on this page as VAR-only; SKA is out of scope by design.
- `HomeInfo`/`TicketPoolInfo` are JSON-tagged and shared with the HTTP API + home page —
  field changes are cross-page.

## Untyped Go → Stimulus String Contract

**Description:** Two coupled string sets — `data-attackcost-*` attribute keys read via
`this.data.get(...)` and the `static targets` array (`attackcost_controller.js:121-185`).
Same pattern as `visualblocks/patterns.md` (untyped Go→JS contract).

**Constraints:**
- Renaming a *data key* → `parseInt(null)=NaN`, silent.
- Renaming/removing a *target* → exception in `connect()`, controller dead (loud).
- Keep template attribute names and the `targets` array in lockstep.

## Vendored-Dygraphs Private Override

**Description:** `attackcost_controller.js:252` monkey-patches the private
`Dygraph.prototype.doZoomY_` to disable Y-axis zoom. Shares the vendored-Dygraphs coupling
seen in the charts/visualblocks flows.

**Constraints:** any Dygraphs upgrade must re-verify the private method name still exists.

See also:
- /wiki/code-analysis/attack-cost/flow.full.md (shares-pattern-with)
- /wiki/code-analysis/visualblocks/patterns.md (shares-pattern-with: untyped Go→JS contract, vendored Dygraphs)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: legacy flat-field shim / `DCR` labelling — address keeps the same back-compat VAR fields, now template-unread)
- /wiki/core/constraints.md (depends-on: C1 numeric precision)
