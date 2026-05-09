// Pure DOM helpers for the home-page mempool fill indicators.
//
// The home page renders a TOTAL bar plus one per-coin fill bar inside an
// .indicator-fill container. Each fill bar has three absolutely-positioned
// segments (.gq-segment, .extra-segment, .overflow-segment) and a marker
// (.gq-marker) sitting at the coin's guaranteed-quota boundary.
//
// These helpers are pure DOM mutators (no Stimulus, no rAF, no globals beyond
// `document`). The controller is responsible for batching calls into a single
// animation frame.

// numOr0 coerces a value to a finite number, defaulting to 0.
function numOr0(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

// computePctOfTC returns the entry's cumulative fill expressed as a percentage
// of the max block size. NOT clamped — a coin whose mempool transactions
// exceed block capacity returns e.g. 115. Mirrors the Go implementation in
// cmd/dcrdata/internal/explorer/explorer.go computeCoinFills.
export function computePctOfTC(entry) {
  return rawFraction(entry) * 100
}

// isOverflow returns true when the entry's cumulative fill exceeds 1.0 (i.e.
// the coin's mempool transactions don't fit in the next block).
export function isOverflow(entry) {
  return rawFraction(entry) > 1.0
}

function rawFraction(entry) {
  if (!entry) return 0
  const gqFill = numOr0(entry.gq_fill_ratio)
  const gqPos = numOr0(entry.gq_position_ratio)
  const extra = numOr0(entry.extra_fill_ratio)
  const overflow = numOr0(entry.overflow_fill_ratio)
  return gqFill * gqPos + extra + overflow
}

// applyFillBar updates an existing .fill-bar element in-place with the values
// from a CoinFillData-like entry. The expected shape matches the JSON payload
// produced by the server (snake_case fields).
export function applyFillBar(barEl, entry) {
  if (!barEl || !entry) return
  const track = barEl.querySelector('.fill-bar__track')
  if (!track) return

  const gqFill = numOr0(entry.gq_fill_ratio)
  const extraFill = numOr0(entry.extra_fill_ratio)
  const overflowFill = numOr0(entry.overflow_fill_ratio)
  const gqPos = numOr0(entry.gq_position_ratio)
  const status = typeof entry.status === 'string' ? entry.status : ''

  const gqSeg = track.querySelector('.gq-segment')
  const extraSeg = track.querySelector('.extra-segment')
  const overflowSeg = track.querySelector('.overflow-segment')
  const marker = track.querySelector('.gq-marker')

  if (gqSeg) {
    gqSeg.style.setProperty('--seg-w', `${(gqFill * gqPos * 100).toFixed(4)}%`)
    gqSeg.hidden = gqFill === 0
  }
  if (extraSeg) {
    extraSeg.style.setProperty('--seg-w', `${(extraFill * 100).toFixed(4)}%`)
    extraSeg.hidden = extraFill === 0
  }
  if (overflowSeg) {
    overflowSeg.style.setProperty('--seg-w', `${(overflowFill * 100).toFixed(4)}%`)
    overflowSeg.hidden = overflowFill === 0
  }
  if (marker) marker.style.left = `${(gqPos * 100).toFixed(4)}%`

  track.style.setProperty('--gq-pos', gqPos.toFixed(6))
  track.dataset.status = ['ok', 'borrowing', 'full'].includes(status) ? status : ''

  const pctOfTC = computePctOfTC(entry)
  barEl.setAttribute('aria-valuenow', Math.round(pctOfTC))
  barEl.setAttribute('aria-label', `${entry.symbol} — ${status || 'unknown'}`)
  if (isOverflow(entry)) {
    barEl.setAttribute('data-overflow', 'true')
  } else {
    barEl.removeAttribute('data-overflow')
  }

  const pct = barEl.querySelector('.fill-bar__pct')
  if (pct) pct.textContent = `${pctOfTC.toFixed(1)}%`
}

// applyTotalBar updates the .total-bar element with the given total fill
// ratio (0.0–∞). Visual width clamps to 100% and the bar's coloured fill is
// hidden when the ratio is exactly 0 (to avoid the 4px-min nub on an empty
// mempool). The percentage text shows the true ratio — values above 100% are
// surfaced verbatim and the data-overflow attribute drives the hatch overlay.
export function applyTotalBar(totalEl, totalFillRatio) {
  if (!totalEl || typeof totalFillRatio !== 'number' || !isFinite(totalFillRatio)) return
  const clamped = Math.min(totalFillRatio, 1.0)
  const fill = totalEl.querySelector('.total-bar__fill')
  if (fill) fill.style.setProperty('--seg-w', `${(clamped * 100).toFixed(4)}%`)
  totalEl.setAttribute('aria-valuenow', Math.round(totalFillRatio * 100))
  const pct = totalEl.querySelector('.total-bar__pct')
  if (pct) pct.textContent = `${(totalFillRatio * 100).toFixed(1)}%`
  if (totalFillRatio > 1.0) {
    totalEl.setAttribute('data-overflow', 'true')
  } else {
    totalEl.removeAttribute('data-overflow')
  }
  if (totalFillRatio === 0) {
    totalEl.setAttribute('data-empty', 'true')
  } else {
    totalEl.removeAttribute('data-empty')
  }
}

// coinSortKey returns a numeric sort key for canonical ordering: VAR=0, SKAn=n;
// unknown coin symbols sort last.
export function coinSortKey(symbol) {
  if (!symbol || symbol === 'VAR') return 0
  const m = symbol.match(/^SKA(\d+)$/)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}

// injectFillBar clones the #fill-bar-template found in `doc`, applies the
// entry, and inserts the new bar into `listEl` in canonical order. Returns the
// inserted element, or null if the template was missing or malformed.
export function injectFillBar(listEl, entry, doc = document) {
  if (!listEl || !entry) return null
  const tmpl = doc.getElementById('fill-bar-template')
  if (!tmpl) return null

  const clone = doc.importNode(tmpl.content, true)
  const bar = clone.querySelector('.fill-bar')
  if (!bar) return null

  bar.dataset.coin = entry.symbol
  const labelEl = bar.querySelector('.fill-bar__label')
  if (labelEl) labelEl.textContent = entry.symbol

  applyFillBar(bar, entry)

  const existing = Array.from(listEl.querySelectorAll('[data-coin]'))
  const key = coinSortKey(entry.symbol)
  const insertBefore = existing.find((el) => coinSortKey(el.dataset.coin) > key)
  if (insertBefore) {
    listEl.insertBefore(bar, insertBefore)
  } else {
    listEl.appendChild(bar)
  }
  return bar
}

// repositionSKAMarkers updates the GQ position and marker on every SKA bar
// inside `listEl` when the number of active SKA coins changes. VAR is left
// alone (its quota is fixed at 10% regardless of SKA count).
export function repositionSKAMarkers(listEl, activeSKACount) {
  if (!listEl || typeof activeSKACount !== 'number' || !(activeSKACount > 0)) return
  const newGQPos = 0.9 / activeSKACount
  const newGQPosStr = newGQPos.toFixed(6)
  listEl.querySelectorAll('[data-coin]').forEach((bar) => {
    const coin = bar.dataset.coin
    if (!coin || coin === 'VAR') return
    const track = bar.querySelector('.fill-bar__track')
    if (track) track.style.setProperty('--gq-pos', newGQPosStr)
    const marker = bar.querySelector('.gq-marker')
    if (marker) marker.style.left = `${(newGQPos * 100).toFixed(4)}%`
  })
}

// zeroFillEntry returns a CoinFillData-shaped entry that zeroes out a bar.
// Used by the controller when a previously-visible coin disappears from the
// payload — its bar stays in the DOM but is reset to empty.
export function zeroFillEntry(symbol) {
  return {
    symbol: symbol,
    gq_fill_ratio: 0,
    extra_fill_ratio: 0,
    overflow_fill_ratio: 0,
    gq_position_ratio: 0,
    status: ''
  }
}
