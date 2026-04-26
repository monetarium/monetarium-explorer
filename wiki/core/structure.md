# Module Boundaries & File Structure

The project governs a multi-module monolithic strategy. The root workspace organizes independent sub-modules that tie into the final `dcrdata` execution binary via explicit `go.mod` path replacements.

## Module Borders
* Root (`.`): `monetarium-explorer` (Shared Blockdata, PubSub, TxHelpers).
* `cmd/dcrdata`: Core Application Executable.
* `db/dcrpg`: PostgreSQL interaction engine.
* `gov`: Network governance and Politeia voting rules.
* `exchanges`: Unconnected legacy exchange bot layer.

## Root Packages Mapping
```
api/types/        → Externalized endpoint signatures and structs
blockdata/        → Chain monitoring ingestion engines
db/dbtypes/       → Shared structs mapping Postgres layers
explorer/types/   → Page structs (the bridge before UI)
mempool/          → Real-time hex parsers and broadcast monitors
pubsub/           → Websocket hub orchestrators
txhelpers/        → Internal numeric array token mapping rules
```

## `cmd/dcrdata` Application Logic
```
internal/                 → Non-importable proprietary logic
  api/                    → REST schemas
  explorer/               → Web interface HTTP handlers
  middleware/             → Security and limits
public/                   → The absolute frontend root
  js/controllers/         → Stimulus JS logic per template
  scss/                   → Core design tokens parsing downward
views/                    → Go `.tmpl` structures providing static DOMs
```

## Internal Code Conventions
* All `.js` interactions MUST follow Stimulus design. Every page is mapped explicitly by a unified `*_controller.js`.
* `public/dist/` is an automated Webpack payload block that is functionally untouchable by developers.
* Internal Go packages require independent `.log.go` declarations explicitly configuring the `decred/slog` engine tracking outputs individually.
