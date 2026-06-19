import { describe, it, expect, vi } from 'vitest'
import { buildOpts, createChart, createSyncKey } from './uplot_adapter'
import { getDefault } from './module_helper'

// Mock the dynamic-import helper so createChart gets a fake uPlot class. The fake
// records constructor args and exposes vi.fn() instance methods for delegation checks.
vi.mock('./module_helper', () => {
  class FakeUPlot {
    constructor(opts, data, el) {
      if (FakeUPlot.failNext) {
        FakeUPlot.failNext = false
        throw new Error('uPlot construction failed')
      }
      this.opts = opts
      this.data = data
      this.el = el
      this.setData = vi.fn((d) => {
        this.data = d
      })
      this.setSeries = vi.fn()
      this.setScale = vi.fn()
      this.setSize = vi.fn()
      this.destroy = vi.fn()
    }
  }
  FakeUPlot.paths = { bars: () => 'BARS', stepped: () => 'STEP', linear: () => 'LINE' }
  FakeUPlot.failNext = false
  return { getDefault: vi.fn().mockResolvedValue(FakeUPlot) }
})

// A fake uPlot constructor: buildOpts only touches the static `.paths` builders.
const fakeUPlot = {
  paths: {
    bars: () => 'BARS',
    stepped: () => 'STEP',
    linear: () => 'LINE'
  }
}

const lineDef = {
  name: 'pow-difficulty',
  label: 'Difficulty',
  axes: [{ label: 'Difficulty', scale: 'y' }],
  series: [{ label: 'Difficulty', scale: 'y', kind: 'line' }]
}

const dualAxisDef = {
  name: 'hashrate',
  label: 'Hashrate',
  axes: [
    { label: 'Hashrate', scale: 'y' },
    { label: 'Active Miners', scale: 'y2' }
  ],
  series: [
    { label: 'Hashrate', scale: 'y', kind: 'line' },
    { label: 'Active Miners', scale: 'y2', kind: 'bars' }
  ]
}

describe('buildOpts — single-axis line chart', () => {
  const opts = buildOpts(fakeUPlot, lineDef, { dark: false, width: 800, height: 400 })

  it('prepends the implicit x series and maps each definition series', () => {
    expect(opts.series).toHaveLength(2) // x + 1 data series
    expect(opts.series[1].label).toBe('Difficulty')
    expect(opts.series[1].scale).toBe('y')
    expect(opts.series[1].stroke).toBe('#2970FF')
    expect(opts.series[1].paths).toBe('LINE')
    expect(opts.series[1].fill).toBeNull() // a line has no fill
  })

  it('declares only the x and y scales (no y2)', () => {
    expect(Object.keys(opts.scales).sort()).toEqual(['x', 'y'])
    expect(opts.scales.y.distr).toBe(1) // linear
  })

  it('disables the built-in legend (the shell renders its own)', () => {
    expect(opts.legend.show).toBe(false)
  })
})

describe('buildOpts — dual-axis with a bars series', () => {
  const opts = buildOpts(fakeUPlot, dualAxisDef, { dark: true, width: 800, height: 400 })

  it('declares the second scale and routes the second series to it', () => {
    expect(Object.keys(opts.scales).sort()).toEqual(['x', 'y', 'y2'])
    expect(opts.series[2].scale).toBe('y2')
  })

  it('uses the bars path and a translucent fill for the bar series', () => {
    expect(opts.series[2].paths).toBe('BARS')
    expect(opts.series[2].fill).toBe('rgba(224, 49, 49, 0.18)') // colorForIndex(1), dark
  })

  it('places the y2 axis on the right (side 1)', () => {
    const y2Axis = opts.axes.find((a) => a.scale === 'y2')
    expect(y2Axis.side).toBe(1)
  })
})

describe('buildOpts — options', () => {
  it('switches the y scale to log when scaleType is log', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { scaleType: 'log' })
    expect(opts.scales.y.distr).toBe(3) // uPlot log distribution
  })

  it('wires cursor.sync when a syncKey is supplied', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { syncKey: 'mon-chart-sync:proposal' })
    expect(opts.cursor.sync.key).toBe('mon-chart-sync:proposal')
  })

  it('omits cursor.sync when no syncKey is supplied', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    expect(opts.cursor.sync).toBeUndefined()
  })

  it('floors the y scale at def.yMin when present', () => {
    const opts = buildOpts(fakeUPlot, { ...lineDef, yMin: 0 }, {})
    expect(typeof opts.scales.y.range).toBe('function')
    expect(opts.scales.y.range(null, -5, 100)).toEqual([0, 100])
  })
})

const handleDef = {
  name: 'hashrate',
  label: 'Hashrate',
  axes: [{ label: 'Hashrate', scale: 'y' }],
  series: [{ label: 'Hashrate', scale: 'y', kind: 'line' }]
}

describe('createSyncKey', () => {
  it('namespaces the key', () => {
    expect(createSyncKey('proposal')).toBe('mon-chart-sync:proposal')
  })
})

describe('createChart / ChartHandle', () => {
  const el = {} // never touched by the fake uPlot

  it('constructs a uPlot for the definition and exposes it', async () => {
    const handle = await createChart(el, handleDef, { width: 640, height: 320 })
    expect(handle.uplot.opts.width).toBe(640)
    expect(handle.uplot.opts.series).toHaveLength(2)
  })

  it('setData delegates to uplot.setData', async () => {
    const handle = await createChart(el, handleDef, {})
    const cols = [
      [1, 2, 3],
      [10, 20, 30]
    ]
    handle.setData(cols)
    expect(handle.uplot.setData).toHaveBeenCalledWith(cols)
  })

  it('setScaleType rebuilds with the new distribution and destroys the old instance', async () => {
    const handle = await createChart(el, handleDef, {})
    const first = handle.uplot
    handle.setScaleType('log')
    expect(first.destroy).toHaveBeenCalled()
    expect(handle.uplot).not.toBe(first)
    expect(handle.uplot.opts.scales.y.distr).toBe(3)
  })

  it('setMode swaps line<->stepped paths via rebuild', async () => {
    const handle = await createChart(el, handleDef, {})
    handle.setMode('stepped')
    expect(handle.uplot.opts.series[1].paths).toBe('STEP')
  })

  it('setMode is a no-op when the requested mode is already in effect', async () => {
    const handle = await createChart(el, handleDef, {}) // all-line
    const first = handle.uplot
    handle.setMode('line')
    expect(handle.uplot).toBe(first) // no rebuild
    expect(first.destroy).not.toHaveBeenCalled()
  })

  it('setScaleType is a no-op when already at the requested scale', async () => {
    const handle = await createChart(el, handleDef, {}) // defaults to linear
    const first = handle.uplot
    handle.setScaleType('linear')
    expect(handle.uplot).toBe(first) // no rebuild
    expect(first.destroy).not.toHaveBeenCalled()
  })

  it('marks the handle inert if a rebuild construction throws (no dead-instance reuse)', async () => {
    const handle = await createChart(el, handleDef, {})
    const FakeUPlot = await getDefault()
    FakeUPlot.failNext = true // make the next construction (the rebuild) throw
    expect(() => handle.setScaleType('log')).toThrow()
    // The old instance was destroyed before the throw; the handle is now inert,
    // so further calls no-op instead of touching the torn-down instance.
    expect(() => handle.setData([[1], [2]])).not.toThrow()
    expect(handle.uplot.setData).not.toHaveBeenCalled()
  })

  it('setVisibility toggles a series by label (1-based uPlot index)', async () => {
    const handle = await createChart(el, handleDef, {})
    handle.setVisibility({ Hashrate: false })
    expect(handle.uplot.setSeries).toHaveBeenCalledWith(1, { show: false })
  })

  it('re-applies a hidden series after a rebuild (a fresh uPlot starts all-shown)', async () => {
    const handle = await createChart(el, handleDef, {})
    handle.setVisibility({ Hashrate: false })
    const before = handle.uplot
    handle.setScaleType('log')
    expect(handle.uplot).not.toBe(before)
    expect(handle.uplot.setSeries).toHaveBeenCalledWith(1, { show: false })
  })

  it('rebuilds at the last resized dimensions', async () => {
    const handle = await createChart(el, handleDef, { width: 800, height: 400 })
    handle.resize(1000, 500)
    handle.setScaleType('log')
    expect(handle.uplot.opts.width).toBe(1000)
    expect(handle.uplot.opts.height).toBe(500)
  })

  it('ignores calls after destroy', async () => {
    const handle = await createChart(el, handleDef, {})
    const inst = handle.uplot
    handle.destroy()
    handle.setData([[1], [2]])
    expect(inst.setData).not.toHaveBeenCalled()
  })

  it('destroy delegates to uplot.destroy', async () => {
    const handle = await createChart(el, handleDef, {})
    const inst = handle.uplot
    handle.destroy()
    expect(inst.destroy).toHaveBeenCalled()
  })
})

describe('buildOpts — xTime / hooks (PR 1 extensions)', () => {
  it('defaults the x scale to time', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    expect(opts.scales.x.time).toBe(true)
  })

  it('sets a non-time x scale when xTime is false', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: false })
    expect(opts.scales.x.time).toBe(false)
  })

  it('passes hooks straight through to the uPlot options', () => {
    const setCursor = () => {}
    const opts = buildOpts(fakeUPlot, lineDef, { hooks: { setCursor: [setCursor] } })
    expect(opts.hooks.setCursor[0]).toBe(setCursor)
  })

  it('omits hooks when none are supplied', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    expect(opts.hooks).toBeUndefined()
  })
})

describe('ChartHandle.setXRange (PR 1 extension)', () => {
  const el = {}

  it('delegates to uplot.setScale on the x scale', async () => {
    const handle = await createChart(el, handleDef, {})
    handle.uplot.setScale = vi.fn()
    handle.setXRange(10, 20)
    expect(handle.uplot.setScale).toHaveBeenCalledWith('x', { min: 10, max: 20 })
  })

  it('re-applies the last x-range after a rebuild', async () => {
    const handle = await createChart(el, handleDef, {})
    handle.setXRange(10, 20)
    handle.setScaleType('log') // forces a rebuild
    expect(handle.uplot.setScale).toHaveBeenCalledWith('x', { min: 10, max: 20 })
  })

  it('no-ops after destroy', async () => {
    const handle = await createChart(el, handleDef, {})
    const inst = handle.uplot
    inst.setScale = vi.fn()
    handle.destroy()
    handle.setXRange(1, 2)
    expect(inst.setScale).not.toHaveBeenCalled()
  })
})

describe('buildOpts — colorKey and axis color matching', () => {
  const colorKeyDef = {
    name: 'ticket-price',
    label: 'Ticket Price',
    axes: [{ label: 'Price', scale: 'y' }],
    series: [{ label: 'Price', scale: 'y', kind: 'line', colorKey: 'tickets-price' }]
  }
  it('resolves colorKey to the light series color', () => {
    const opts = buildOpts(fakeUPlot, colorKeyDef, { dark: false })
    expect(opts.series[1].stroke).toBe('#2970ff')
  })
  it('resolves colorKey to the dark series color', () => {
    const opts = buildOpts(fakeUPlot, colorKeyDef, { dark: true })
    expect(opts.series[1].stroke).toBe('#2dd8a3')
  })
  it('y-axis stroke matches the series color (light)', () => {
    const opts = buildOpts(fakeUPlot, colorKeyDef, { dark: false })
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    expect(yAxis.stroke).toBe('#2970ff')
  })
  it('y-axis stroke matches the series color (dark)', () => {
    const opts = buildOpts(fakeUPlot, colorKeyDef, { dark: true })
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    expect(yAxis.stroke).toBe('#2dd8a3')
  })
})

describe('buildOpts — explicit color, dash, spanGaps', () => {
  const explicitDef = {
    name: 'ref',
    label: 'Ref',
    axes: [{ label: 'Size', scale: 'y' }],
    series: [
      { label: 'Target', scale: 'y', kind: 'line', color: '#888', dash: [5, 3], spanGaps: true }
    ]
  }
  it('uses the explicit color directly', () => {
    const opts = buildOpts(fakeUPlot, explicitDef, { dark: false })
    expect(opts.series[1].stroke).toBe('#888')
  })
  it('sets dash on the series', () => {
    const opts = buildOpts(fakeUPlot, explicitDef, {})
    expect(opts.series[1].dash).toEqual([5, 3])
  })
  it('sets spanGaps true on the series', () => {
    const opts = buildOpts(fakeUPlot, explicitDef, {})
    expect(opts.series[1].spanGaps).toBe(true)
  })
  it('explicit-color series does NOT capture y-axis color (falls back to c.axis)', () => {
    const opts = buildOpts(fakeUPlot, explicitDef, { dark: false })
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    // All series on y have explicit color → fall back to c.axis for light mode
    expect(yAxis.stroke).toBe('#2d2d2d')
  })
})
