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
