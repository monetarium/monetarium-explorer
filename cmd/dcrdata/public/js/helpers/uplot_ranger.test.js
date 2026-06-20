import { describe, it, expect } from 'vitest'
import {
  buildRangerOpts,
  clampBoundary,
  BOUNDARY_LEFT,
  BOUNDARY_RIGHT,
  BOUNDARY_BOTH
} from './uplot_ranger'

// buildRangerOpts only touches the static `.paths` builders.
const fakeUPlot = { paths: { linear: () => 'LINE' } }

const def = {
  name: 'pow-difficulty',
  label: 'Difficulty',
  axes: [{ label: 'Difficulty', scale: 'y' }],
  series: [{ label: 'Difficulty', scale: 'y', kind: 'line', colorIndex: 0 }]
}

describe('buildRangerOpts', () => {
  it('enables drag-to-select and disables drag-to-zoom', () => {
    const o = buildRangerOpts(fakeUPlot, def, {})
    expect(o.cursor.drag.setSelect).toBe(true)
    expect(o.cursor.drag.setScale).toBe(false)
    expect(o.cursor.drag.x).toBe(true)
    expect(o.cursor.drag.y).toBe(false)
  })

  it('disables the cursor crosshair and hides the legend', () => {
    const o = buildRangerOpts(fakeUPlot, def, {})
    expect(o.cursor.x).toBe(false)
    expect(o.cursor.y).toBe(false)
    expect(o.legend.show).toBe(false)
  })

  it('follows xTime on the x scale', () => {
    expect(buildRangerOpts(fakeUPlot, def, { xTime: true }).scales.x.time).toBe(true)
    expect(buildRangerOpts(fakeUPlot, def, { xTime: false }).scales.x.time).toBe(false)
  })

  it('renders only the primary series, area-filled, in its palette color', () => {
    const o = buildRangerOpts(fakeUPlot, def, { dark: false })
    expect(o.series).toHaveLength(2) // implicit x + primary
    expect(o.series[1].label).toBe('Difficulty')
    expect(o.series[1].stroke).toBe('#2970FF') // PALETTE[0]
    expect(o.series[1].fill).toBeTruthy()
    expect(o.series[1].paths).toBe('LINE')
  })

  it('hides the y-axis and keeps a visible x-axis', () => {
    const o = buildRangerOpts(fakeUPlot, def, {})
    expect(o.axes).toHaveLength(2)
    expect(o.axes[1].show).toBe(false) // y hidden
    expect(o.axes[0].show).not.toBe(false) // x shown
  })
})

describe('clampBoundary', () => {
  it('BOTH within bounds returns the moved window unchanged', () => {
    expect(clampBoundary(100, 300, BOUNDARY_BOTH, 800)).toEqual({ left: 100, width: 200 })
  })
  it('BOTH preserves width when clamped to the right edge', () => {
    expect(clampBoundary(700, 900, BOUNDARY_BOTH, 800)).toEqual({ left: 600, width: 200 })
  })
  it('BOTH preserves width when clamped to the left edge', () => {
    expect(clampBoundary(-50, 150, BOUNDARY_BOTH, 800)).toEqual({ left: 0, width: 200 })
  })
  it('LEFT clamps to [0,maxRgt] and never crosses the right edge', () => {
    expect(clampBoundary(50, 300, BOUNDARY_LEFT, 800)).toEqual({ left: 50, width: 250 })
    expect(clampBoundary(400, 300, BOUNDARY_LEFT, 800)).toEqual({ left: 300, width: 0 })
    expect(clampBoundary(-20, 300, BOUNDARY_LEFT, 800)).toEqual({ left: 0, width: 300 })
  })
  it('RIGHT clamps to [0,maxRgt] and never crosses the left edge', () => {
    expect(clampBoundary(100, 350, BOUNDARY_RIGHT, 800)).toEqual({ left: 100, width: 250 })
    expect(clampBoundary(100, 50, BOUNDARY_RIGHT, 800)).toEqual({ left: 100, width: 0 })
    expect(clampBoundary(100, 900, BOUNDARY_RIGHT, 800)).toEqual({ left: 100, width: 700 })
  })
})
