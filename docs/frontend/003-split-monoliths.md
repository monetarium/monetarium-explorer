# Stage 3 — Split monoliths

**Effort**: Medium · **Parallelizable**: Partial · **Depends on**: Stage 2 (safety net)

Break the largest files into focused units so each module has one clear responsibility.

---

## Tasks

### 3.1 Split `humanize_helper.js` (307 lines)

Extract into focused modules under `public/js/helpers/`:

- `time_helper.js` — `timeSince`, `date`
- `format_helper.js` — `commaWithDecimal`, `threeSigFigs`, `twoDecimals`, `bytes`, `fmtPercentage`,
  `capitalize`, `formatAtomsAsCoinString`, `formatCoinAtoms`, `skaCoinValue`, `decimalParts`
- `hash_helper.js` — `hashElide`, `hashParts`
- `humanize_helper.js` becomes a re-export barrel (or delete and update imports)

### 3.2 Extract from `address_controller.js` (913 lines)

Split along existing seams:

- Extract chart-data fetching and caching into `address_chart_helper.js`
- Extract pagination logic into `address_pagination_helper.js`
- Extract QR code logic (self-contained, ~30 lines) into `address_qr_helper.js`
- Keep remaining orchestration in the controller (~400 lines)

### 3.3 Extract from `charts_controller.js` (612 lines)

- Extract zoom/range/resize math into `charts_zoom_helper.js`
- Extract visibility and control-bar logic into `charts_controls_helper.js`
- Keep chart lifecycle + fetch in the controller

### 3.4 Extract from `homepage_controller.js` (277 lines)

- Extract mempool rendering into `home_mempool_helper.js`
- Extract indicator update logic into `home_indicator_helper.js`
