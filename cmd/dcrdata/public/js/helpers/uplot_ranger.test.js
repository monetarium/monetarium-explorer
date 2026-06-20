import { describe, it, expect, vi } from 'vitest'
import {
  buildRangerOpts,
  clampBoundary,
  BOUNDARY_LEFT,
  BOUNDARY_RIGHT,
  BOUNDARY_BOTH,
  createRanger
} from './uplot_ranger'

// Mock the dynamic-import helper so the adapter's loadUPlot() yields a fake uPlot class.
// The fake builds a real DOM root (jsdom) containing `.u-select`, fires `ready`
// synchronously like uPlot, and uses 1:1 pos<->val so selection math is checkable.
vi.mock('./module_helper', () => {
  class FakeUPlot {
    constructor(opts, data) {
      this.opts = opts
      this.data = data
      this.root = document.createElement('div')
      const sel = document.createElement('div')
      sel.className = 'u-select'
      this.root.appendChild(sel)
      this.select = { left: 0, top: 0, width: 0, height: 0 }
      this.bbox = { width: 800, height: 80 }
      this.setData = vi.fn((d) => {
        this.data = d
      })
      this.setSelect = vi.fn((o, fire) => {
        this.select = { ...this.select, ...o }
        this._lastFire = fire
      })
      this.destroy = vi.fn()
      const ready = (opts.hooks && opts.hooks.ready) || []
      ready.forEach((fn) => fn(this))
    }

    posToVal(pos) {
      return pos
    }

    valToPos(val) {
      return val
    }
  }
  FakeUPlot.paths = { linear: () => 'LINE', bars: () => 'BARS', stepped: () => 'STEP' }
  FakeUPlot.pxRatio = 1
  return { getDefault: vi.fn().mockResolvedValue(FakeUPlot) }
})

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

const rangerDef = {
  name: 'pow-difficulty',
  label: 'Difficulty',
  axes: [{ label: 'Difficulty', scale: 'y' }],
  series: [{ label: 'Difficulty', scale: 'y', kind: 'line', colorIndex: 0 }]
}

describe('createRanger.setSelection', () => {
  it('repositions the rectangle WITHOUT firing the setSelect hook (fire=false)', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    h.setSelection(10, 40)
    expect(h.uplot.setSelect).toHaveBeenCalled()
    const call = h.uplot.setSelect.mock.calls.at(-1)
    expect(call[0]).toMatchObject({ left: 10, width: 30 })
    expect(call[1]).toBe(false)
  })
})

describe('createRanger grip drag', () => {
  it('a right-grip drag moves only the right edge and calls onSelect with converted bounds', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn()
      return 1
    })
    const onSelect = vi.fn()
    const h = await createRanger(document.createElement('div'), rangerDef, { onSelect })
    h.setSelection(100, 300) // select.left=100, width=200

    const sel = h.uplot.root.querySelector('.u-select')
    const grip = sel.querySelector('.u-grip-r')
    expect(grip).toBeTruthy()

    grip.dispatchEvent(new MouseEvent('mousedown', { clientX: 300, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls.at(-1)).toEqual([100, 350])
    vi.unstubAllGlobals()
  })

  it('stops listening after mouseup (no further onSelect)', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn()
      return 1
    })
    const onSelect = vi.fn()
    const h = await createRanger(document.createElement('div'), rangerDef, { onSelect })
    h.setSelection(100, 300)
    const sel = h.uplot.root.querySelector('.u-select')
    sel.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    onSelect.mockClear()
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, bubbles: true }))
    expect(onSelect).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('createRanger.destroy', () => {
  it('destroys the uplot and no-ops afterward', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    const inst = h.uplot
    h.destroy()
    expect(inst.destroy).toHaveBeenCalled()
    h.setSelection(1, 2) // no throw, no-op
    expect(inst.setSelect).not.toHaveBeenCalled()
  })
})
