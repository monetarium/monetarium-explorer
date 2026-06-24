// Classify a touch drag by dominant axis, to disambiguate a horizontal chart scrub from a
// vertical page scroll. Pure. Returns 'pending' until the movement exceeds `threshold` on
// the dominant axis. Horizontal must strictly dominate to 'scrub'; ties (a perfect
// diagonal) resolve to 'scroll' so an ambiguous gesture yields to page scroll rather than
// hijacking it. Sign-agnostic — only magnitudes matter.
export function classifyGesture(dx, dy, threshold) {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax > threshold && ax > ay) return 'scrub'
  if (ay > threshold && ay >= ax) return 'scroll'
  return 'pending'
}

// Decide whether the current tap forms a double-tap with the previous one. Pure. `prev` is the
// prior tap (null/undefined if there was none) and `curr` the current tap, each { t, x, y } with
// t in ms. A double-tap is two taps within `windowMs` whose positions differ by at most
// `moveThreshold` px on each axis. No prior tap, too slow, or too far apart -> false. Boundaries
// are inclusive (exactly at the window / threshold still counts), sign-agnostic on position.
export function isDoubleTap(prev, curr, { windowMs = 300, moveThreshold = 30 } = {}) {
  if (!prev) return false
  if (curr.t - prev.t > windowMs) return false
  if (Math.abs(curr.x - prev.x) > moveThreshold) return false
  if (Math.abs(curr.y - prev.y) > moveThreshold) return false
  return true
}
