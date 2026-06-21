/* global MouseEvent */
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
      this.width = opts.width || 800
      this.height = opts.height || 80
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
      this.redraw = vi.fn()
      this.setSize = vi.fn()
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

  it('hides both axes — no x or y labels on the strip', () => {
    const o = buildRangerOpts(fakeUPlot, def, {})
    expect(o.axes).toHaveLength(2)
    expect(o.axes[0].show).toBe(false) // x-axis hidden (main chart's sits above)
    expect(o.axes[1].show).toBe(false) // y-axis removed
  })

  it('reserves the left/right gutters via padding from the getters', () => {
    const o = buildRangerOpts(fakeUPlot, def, { getLeftGutter: () => 47, getRightGutter: () => 31 })
    // padding = [top, right, bottom, left]
    expect(o.padding[3]()).toBe(47) // left inset mirrors the main chart's left gutter
    expect(o.padding[1]()).toBe(31) // right inset mirrors the main chart's right gutter
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

// A def whose primary series uses a theme-aware named color (light #2970ff, dark #2dd8a3),
// so the selection tint visibly differs between themes.
const colorKeyDef = {
  name: 'ticket-price',
  label: 'Ticket Price',
  axes: [{ label: 'Price', scale: 'y' }],
  series: [{ label: 'Price', scale: 'y', kind: 'line', colorKey: 'tickets-price' }]
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
  // jsdom has no PointerEvent constructor; a MouseEvent carries clientX and we hang
  // pointerId on it so the capture path runs. setPointerCapture is stubbed per-grip.
  function pointer(type, clientX) {
    const e = new MouseEvent(type, { clientX: clientX, bubbles: true })
    e.pointerId = 1
    return e
  }

  it('a right-grip pointer drag moves only the right edge and converts the bounds', async () => {
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
    grip.setPointerCapture = vi.fn()

    grip.dispatchEvent(pointer('pointerdown', 300))
    expect(grip.setPointerCapture).toHaveBeenCalledWith(1)
    document.dispatchEvent(pointer('pointermove', 350))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls.at(-1)).toEqual([100, 350])
    vi.unstubAllGlobals()
  })

  it('stops listening after pointerup (no further onSelect)', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fn()
      return 1
    })
    const onSelect = vi.fn()
    const h = await createRanger(document.createElement('div'), rangerDef, { onSelect })
    h.setSelection(100, 300)
    const sel = h.uplot.root.querySelector('.u-select')
    sel.setPointerCapture = vi.fn()
    sel.dispatchEvent(pointer('pointerdown', 200))
    document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    onSelect.mockClear()
    document.dispatchEvent(pointer('pointermove', 250))
    expect(onSelect).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('createRanger.setGutters', () => {
  it('relayouts when the gutters change and no-ops when unchanged', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    h.uplot.setSize.mockClear()
    h.setGutters(40, 20)
    expect(h.uplot.opts.padding[3]()).toBe(40) // left gutter applied live
    expect(h.uplot.opts.padding[1]()).toBe(20) // right gutter applied live
    expect(h.uplot.setSize).toHaveBeenCalledTimes(1)
    h.setGutters(40, 20) // unchanged → no relayout
    expect(h.uplot.setSize).toHaveBeenCalledTimes(1)
    h.setGutters(55, 20) // changed
    expect(h.uplot.setSize).toHaveBeenCalledTimes(2)
  })

  it('no-ops after destroy', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    h.destroy()
    h.uplot.setSize.mockClear()
    h.setGutters(99, 99)
    expect(h.uplot.setSize).not.toHaveBeenCalled()
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

describe('createRanger selection tint', () => {
  it('tints the selection rectangle and grips with the primary line color', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, { dark: false })
    const sel = h.uplot.root.querySelector('.u-select')
    const gl = sel.querySelector('.u-grip-l')
    const gr = sel.querySelector('.u-grip-r')
    expect(sel.style.background).toBe('rgba(41, 112, 255, 0.14)') // palette[0] #2970FF @ 0.14
    expect(sel.style.borderLeftColor).toBe('rgba(41, 112, 255, 0.55)')
    expect(sel.style.borderRightColor).toBe('rgba(41, 112, 255, 0.55)')
    expect(gl.style.background).toBe('rgba(41, 112, 255, 0.55)')
    expect(gr.style.background).toBe('rgba(41, 112, 255, 0.55)')
  })

  it('re-tints to the new theme line color on a dark-mode rebuild', async () => {
    const h = await createRanger(document.createElement('div'), colorKeyDef, { dark: false })
    let gl = h.uplot.root.querySelector('.u-select .u-grip-l')
    expect(gl.style.background).toBe('rgba(41, 112, 255, 0.55)') // light tickets-price #2970ff
    h.setDark(true)
    gl = h.uplot.root.querySelector('.u-select .u-grip-l') // rebuilt instance, fresh grips
    expect(gl.style.background).toBe('rgba(45, 216, 163, 0.55)') // dark tickets-price #2dd8a3
  })
})

describe('createRanger.setWidth', () => {
  it('calls setSize with the new width and the current height when the width changes', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    h.uplot.setSize.mockClear()
    const currentHeight = h.uplot.height // FakeUPlot defaults to 80
    h.setWidth(1200)
    expect(h.uplot.setSize).toHaveBeenCalledWith({ width: 1200, height: currentHeight })
  })

  it('is a no-op when the width is unchanged (within 0.5 px)', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    h.uplot.setSize.mockClear()
    // FakeUPlot initialises width = opts.width || 800
    h.setWidth(800) // same as current width → should not relayout
    expect(h.uplot.setSize).not.toHaveBeenCalled()
  })

  it('is a no-op after destroy', async () => {
    const h = await createRanger(document.createElement('div'), rangerDef, {})
    h.destroy()
    h.uplot.setSize.mockClear()
    h.setWidth(1200)
    expect(h.uplot.setSize).not.toHaveBeenCalled()
  })
})
