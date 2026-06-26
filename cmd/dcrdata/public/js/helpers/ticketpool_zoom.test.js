import { describe, it, expect } from 'vitest'
import { timesToEpoch, computeZoomWindow, clampWindow } from './ticketpool_zoom'

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
