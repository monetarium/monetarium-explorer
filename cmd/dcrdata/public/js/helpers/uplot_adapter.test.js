import { describe, it, expect, vi } from 'vitest'
import { buildOpts, createChart, createSyncKey } from './uplot_adapter'

// Mock the dynamic-import helper so createChart gets a fake uPlot class. The fake
// records constructor args and exposes vi.fn() instance methods for delegation checks.
vi.mock('./module_helper', () => {
  class FakeUPlot {
    constructor(opts, data, el) {
      this.opts = opts
      this.data = data
      this.el = el
      this.setData = vi.fn((d) => {
        this.data = d
      })
      this.setSeries = vi.fn()
      this.setSize = vi.fn()
      this.destroy = vi.fn()
    }
  }
  FakeUPlot.paths = { bars: () => 'BARS', stepped: () => 'STEP', linear: () => 'LINE' }
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
