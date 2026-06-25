import { describe, it, expect } from 'vitest'
import {
  timesToEpoch,
  computeZoomWindow,
  clampWindow,
  alignViewportToData
} from './ticketpool_zoom'

const DMIN = 1780963200 // Jun 9 2026
const DMAX = 1782172800 // Jun 23 2026 (span = 1209600 = 14 days)

describe('timesToEpoch', () => {
  it('converts ISO strings to epoch seconds', () => {
    expect(timesToEpoch(['2026-06-09T00:00:00Z'])).toEqual([DMIN])
  })
  it('returns [] for missing input', () => {
    expect(timesToEpoch(undefined)).toEqual([])
  })
})

describe('computeZoomWindow', () => {
  it('all -> full data extent', () => {
    expect(computeZoomWindow('all', [DMIN, DMAX])).toEqual([DMIN, DMAX])
  })
  it('wk on a 14-day span -> [DMAX-604800, DMAX]', () => {
    expect(computeZoomWindow('wk', [DMIN, 1781568000, DMAX])).toEqual([1781568000, DMAX])
  })
  it('mo wider than the data span -> full extent', () => {
    expect(computeZoomWindow('mo', [DMIN, DMAX])).toEqual([DMIN, DMAX])
  })
  it('day window is exactly 86400 wide', () => {
    const [lo, hi] = computeZoomWindow('day', [DMIN, DMAX])
    expect(hi - lo).toBe(86400)
    expect(hi).toBe(DMAX)
  })
})

describe('clampWindow', () => {
  it('shifts a window that starts before dataMin, keeping its duration', () => {
    expect(clampWindow(50, 150, 100)).toEqual([100, 200])
  })
  it('leaves an in-range window untouched', () => {
    expect(clampWindow(120, 150, 100)).toEqual([120, 150])
  })
})

describe('alignViewportToData', () => {
  it('expands the right edge to include new data past the viewport', () => {
    expect(alignViewportToData(DMIN, DMAX, DMIN, 1782259200)).toEqual([DMIN, 1782259200])
  })
  it('does not clip when new data is inside the viewport', () => {
    expect(alignViewportToData(DMIN, DMAX, DMIN, DMIN)).toEqual([DMIN, DMAX])
  })
  it('restores full blocks extent from a truncated viewport (real API timestamps)', () => {
    // viewport at day boundaries; blocks data slightly inside-left, past-right
    expect(alignViewportToData(1781308800, 1782259200, 1781391640, 1782335345)).toEqual([
      1781391640, 1782335345
    ])
  })
})
