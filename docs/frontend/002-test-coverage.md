# Stage 2 — Test gap closure

**Effort**: Medium · **Parallelizable**: Yes · **Depends on**: Nothing

Add tests for every untested module. Ordered from pure-function helpers (fastest, most
valuable) up to complex controllers.

---

## Tasks

### 2.1 Helpers

- `animation_helper` — test `animationFrame` and `fadeIn` (pure + DOM)
- `block_helper` — test `txInBlock` (pure function)
- `http` — test `requestJSON` (mock fetch)
- `live_block_table` — DOM rendering
- `mempool_helper` — `Mempool` class: init, replace, merge, totals, counts
- `meters` — canvas rendering (snapshot or mock ctx)
- `module_helper` — `getDefault`
- `turbo_helper` — `TurboQuery`: URL parsing, query projection
- `zoom_helper` — `Zoom` static methods: encode, decode, validate, mapKey, project

### 2.2 Services

- `cookie_service` — read/write cookie parsing
- `keyboard_navigation_service` — key event routing
- `theme_service` — DOM class/cookie toggling

### 2.3 Simple controllers

- `clipboard_controller` — clipboard API mock
- `search_controller` — form submit + Turbo.visit
- `menu_controller` — clickout, toggle, sun click
- `status_controller` — status event rendering
- `sticky_col_controller` — scroll-based column sticking
- `rawtx_controller` — raw transaction view
- `pagenavigation_controller` — page size, vote status, list view selectors

### 2.4 Complex controllers

- `supply_controller` — supply chart data handling
- `attackcost_controller` — attack cost calculations
- `agendas_controller` — agenda list
