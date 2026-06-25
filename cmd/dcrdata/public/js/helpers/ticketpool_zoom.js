// Pure zoom-window + range-union math for the ticketpool charts. Extracted from the
// controller so the exact range arithmetic is unit-tested in isolation.

const PRESET_SECONDS = { day: 86400, wk: 604800, mo: 2628000 }

// ISO time strings (the /api/ticketpool response shape) -> epoch seconds.
export function timesToEpoch(times) {
  return (times || []).map((t) => new Date(t).getTime() / 1000)
}

// The visible window for a zoom preset, anchored at the data's right edge. Returns the
// full [dataMin, dataMax] for 'all' or when the preset is wider than the data span.
export function computeZoomWindow(val, xs) {
  const dataMin = xs.length ? xs[0] : 0
  const dataMax = xs.length ? xs[xs.length - 1] : Date.now() / 1000
  const dataSpan = dataMax - dataMin
  const span = PRESET_SECONDS[val]
  if (!span) return [dataMin, dataMax]
  const lo = dataMax - span
  const hi = dataMax
  if (dataSpan <= hi - lo) return [dataMin, dataMax]
  return clampWindow(lo, hi, dataMin)
}

// Keep a window's duration but never start before dataMin.
export function clampWindow(lo, hi, dataMin) {
  const duration = hi - lo
  if (lo < dataMin) return [dataMin, dataMin + duration]
  return [lo, hi]
}

// Reconcile the saved viewport with the new data's extent: snap the left edge up to where
// data begins, grow the right edge out to where data ends. Preserves the saved window
// otherwise. (Not a pure expand — the left edge contracts toward dataMin when the data starts
// later than the saved viewport, e.g. a coarse day-boundary view snapping to the first block.)
export function alignViewportToData(prevMin, prevMax, dataMin, dataMax) {
  return [Math.max(prevMin, dataMin), Math.max(prevMax, dataMax)]
}
