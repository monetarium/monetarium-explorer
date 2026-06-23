import { describe, it, expect, vi, beforeEach } from 'vitest'
import uPlot from 'uplot'
import {
  applyLogFloors,
  buildOpts,
  createChart,
  createSyncKey,
  logRange,
  niceLinearTicks,
  stack,
  trimTrailingZeros
} from './uplot_adapter'
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
      this.scales = { x: { min: null, max: null }, y: {} }
      this.setData = vi.fn((d) => {
        this.data = d
        // Real uPlot autoscales on setData and fires setScale via commit() -> a
        // microtask; model the async firing so the adapter's suppression (which also
        // clears on a microtask) is exercised the way it runs in the browser.
        if (d && d[0] && d[0].length) {
          this.scales.x = { min: d[0][0], max: d[0][d[0].length - 1] }
          queueMicrotask(() => this._fire('setScale', 'x'))
        }
      })
      this.setSeries = vi.fn()
      this.setScale = vi.fn((key, range) => {
        this.scales[key] = { ...(this.scales[key] || {}), ...range }
        queueMicrotask(() => this._fire('setScale', key))
      })
      this.setSize = vi.fn()
      this.destroy = vi.fn()
    }

    // Invoke the registered hooks of a given type, mirroring uPlot's synchronous firing.
    _fire(type, ...args) {
      const arr = (this.opts && this.opts.hooks && this.opts.hooks[type]) || []
      arr.forEach((fn) => fn(this, ...args))
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

  it('hugs a near-constant series in log mode so it fills the plot', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { scaleType: 'log' })
    expect(typeof opts.scales.y.range).toBe('function')
    const [lo, hi] = opts.scales.y.range(null, 5000, 5125)
    // The data must stay enclosed, but the range must be tight (a near-constant
    // series should not float in empty space): well under one extra decade.
    expect(lo).toBeLessThan(5000)
    expect(hi).toBeGreaterThan(5125)
    expect(hi / lo).toBeLessThan(1.1)
  })

  it('gives the log y-axis adaptive splits + values, not the int/sigfig formatter', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { scaleType: 'log' })
    const y = opts.axes[1]
    expect(typeof y.splits).toBe('function')
    // Sub-decade range → linear nice-ticks inside it (uPlot would otherwise draw none).
    const ticks = y.splits(null, 1, 5105, 5170)
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.every((t) => t >= 5105 && t <= 5170)).toBe(true)
    // Wide range → 1/2/5×10ⁿ decade ticks.
    const wide = y.splits(null, 1, 100, 100000)
    expect(wide).toContain(1000)
    expect(wide).toContain(10000)
  })

  it('falls back to grouped numbers when sigfig labels would collide', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { scaleType: 'log' })
    const y = opts.axes[1]
    // 5118 and 5119 both round to "5.12k" — must disambiguate.
    expect(y.values(null, [5118, 5119, 5120])).toEqual(['5,118', '5,119', '5,120'])
    // Distinct sigfig labels are kept compact.
    expect(y.values(null, [5110, 5120, 5130])).toEqual(['5.11k', '5.12k', '5.13k'])
  })

  it('ignores def.yMin in log mode (log requires a positive floor)', () => {
    const opts = buildOpts(fakeUPlot, { ...lineDef, yMin: 0 }, { scaleType: 'log' })
    const [lo] = opts.scales.y.range(null, 100, 1000)
    expect(lo).toBeGreaterThan(0)
  })

  it('pins the log y-axis bottom to a series logFloor so floored values hide on the baseline', () => {
    const def = {
      ...lineDef,
      series: [{ label: 'Coin Supply', scale: 'y', kind: 'area', logFloor: 1 }]
    }
    const opts = buildOpts(fakeUPlot, def, { scaleType: 'log' })
    const [lo, hi] = opts.scales.y.range(null, 1, 1e9)
    expect(lo).toBe(1)
    expect(hi).toBeGreaterThan(1e9)
  })

  it('sets a 16px axis label font on the y axis', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    expect(opts.axes[1].labelFont).toContain('16px')
  })

  it('gaps the y-axis title off its tick values so they do not overlap', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    // uPlot centers the label at the values' outer edge, so with the default
    // labelGap (0) the title touches wide ticks like "0.0035". A positive gap
    // pushes it clear; labelSize must stay wide enough to hold the shifted label.
    expect(opts.axes[1].labelGap).toBeGreaterThan(0)
    expect(opts.axes[1].labelSize).toBeGreaterThan(30)
  })

  it('gaps the title off the tick values on the right (y2) axis too', () => {
    const opts = buildOpts(fakeUPlot, dualAxisDef, {})
    const y2 = opts.axes.find((a) => a.scale === 'y2')
    expect(y2.labelGap).toBeGreaterThan(0)
  })

  it('renders integer-only ticks for an intTicks axis', () => {
    const def = {
      ...dualAxisDef,
      axes: [
        { label: 'Hashrate', scale: 'y' },
        { label: 'Active Miners', scale: 'y2', intTicks: true }
      ]
    }
    const opts = buildOpts(fakeUPlot, def, {})
    const y2 = opts.axes.find((a) => a.scale === 'y2')
    expect(y2.incrs).toContain(1)
    expect(y2.incrs.every((n) => Number.isInteger(n))).toBe(true)
    // A fractional split would never be chosen, but the formatter rounds defensively.
    expect(y2.values(null, [2.5, 10, 1000])).toEqual(['3', '10', '1,000'])
  })

  it('passes an explicit series width through to uPlot', () => {
    const def = {
      ...lineDef,
      series: [{ label: 'Difficulty', scale: 'y', kind: 'line', width: 2 }]
    }
    const opts = buildOpts(fakeUPlot, def, {})
    expect(opts.series[1].width).toBe(2)
  })

  it('produces a non-null fill for a stepped series with fill: true', () => {
    const def = {
      ...lineDef,
      series: [{ label: 'Balance', scale: 'y', kind: 'stepped', colorIndex: 0, fill: true }]
    }
    const opts = buildOpts(fakeUPlot, def, {})
    expect(opts.series[1].fill).not.toBeNull()
  })

  it('produces a null fill for a stepped series without fill (opt-in only)', () => {
    const def = {
      ...lineDef,
      series: [{ label: 'Balance', scale: 'y', kind: 'stepped', colorIndex: 0 }]
    }
    const opts = buildOpts(fakeUPlot, def, {})
    expect(opts.series[1].fill).toBeNull()
  })
})

describe('logRange', () => {
  it('hugs the data tightly so a near-constant series fills the plot', () => {
    const [lo, hi] = logRange(5000, 5125)
    expect(lo).toBeLessThan(5000)
    expect(hi).toBeGreaterThan(5125)
    // Padding is a small fraction of the visible span, not a fixed decade.
    expect(hi / lo).toBeLessThan(1.05)
  })

  it('keeps a small but finite range for a perfectly flat series', () => {
    const [lo, hi] = logRange(5000, 5000)
    expect(lo).toBeLessThan(5000)
    expect(hi).toBeGreaterThan(5000)
    const mid = Math.pow(10, (Math.log10(lo) + Math.log10(hi)) / 2)
    expect(mid).toBeCloseTo(5000, 0)
  })

  it('returns strictly positive bounds when data is non-positive or non-finite', () => {
    expect(logRange(0, 0).every((v) => v > 0)).toBe(true)
    expect(logRange(-5, 100).every((v) => v > 0 && isFinite(v))).toBe(true)
    expect(logRange(null, null).every((v) => v > 0 && isFinite(v))).toBe(true)
    expect(logRange(Infinity, Infinity).every((v) => v > 0 && isFinite(v))).toBe(true)
  })

  it('pins the lower bound exactly to a positive floor (no padding below it)', () => {
    // The floored values (e.g. SKA coin-supply leading zeros raised to 1) must rest on
    // the baseline, not float above it — so the axis bottom IS the floor, with no pad.
    const [lo, hi] = logRange(1, 1e9, 1)
    expect(lo).toBe(1)
    expect(hi).toBeGreaterThan(1e9) // the top still gets a little headroom
  })

  it('keeps a finite range when the floored series is flat at the floor', () => {
    const [lo, hi] = logRange(1, 1, 1)
    expect(lo).toBe(1)
    expect(hi).toBeGreaterThan(1)
  })

  it('ignores a non-positive or absent floor (pads below the data as usual)', () => {
    expect(logRange(5000, 5125, 0)[0]).toBeLessThan(5000)
    expect(logRange(5000, 5125, null)[0]).toBeLessThan(5000)
    expect(logRange(5000, 5125)[0]).toBeLessThan(5000)
  })

  it('hugs tightly (does not pin) when the visible data is all above the floor', () => {
    // Zoomed into the plateau, no floored values are in view, so the floor must not
    // strand the data near the top — hug it the way an unfloored series would.
    const [lo, hi] = logRange(5000, 5125, 1)
    expect(lo).toBeGreaterThan(4000)
    expect(hi / lo).toBeLessThan(1.1)
  })
})

describe('trimTrailingZeros', () => {
  it('drops trailing fractional zeros from whole-number labels', () => {
    expect(trimTrailingZeros('75.0')).toBe('75')
    expect(trimTrailingZeros('5.00')).toBe('5')
    expect(trimTrailingZeros('-25.0')).toBe('-25')
  })

  it('drops trailing zeros but keeps significant decimals (suffixed labels)', () => {
    expect(trimTrailingZeros('1.00k')).toBe('1k')
    expect(trimTrailingZeros('12.0k')).toBe('12k')
    expect(trimTrailingZeros('1.50k')).toBe('1.5k')
    expect(trimTrailingZeros('1.50M')).toBe('1.5M')
    expect(trimTrailingZeros('5.10k')).toBe('5.1k')
  })

  it('leaves labels with no removable zeros untouched', () => {
    expect(trimTrailingZeros('5.11k')).toBe('5.11k')
    expect(trimTrailingZeros('5.01k')).toBe('5.01k')
    expect(trimTrailingZeros('300')).toBe('300')
    expect(trimTrailingZeros('5,118')).toBe('5,118')
    expect(trimTrailingZeros('0')).toBe('0')
  })
})

describe('applyLogFloors', () => {
  const floored = [{ label: 'Coin Supply', logFloor: 1 }]
  it('returns columns unchanged (same ref) on a linear scale', () => {
    const cols = [
      [1, 2, 3],
      [0, 0.5, 5]
    ]
    expect(applyLogFloors(cols, floored, false)).toBe(cols)
  })
  it('returns columns unchanged when no series declares a floor', () => {
    const cols = [
      [1, 2],
      [0, 5]
    ]
    expect(applyLogFloors(cols, [{ label: 'A' }], true)).toBe(cols)
  })
  it('raises sub-floor values to the floor on log; x and >=floor values untouched', () => {
    const cols = [
      [10, 20, 30, 40],
      [0, 0.5, 1, 4.5e12]
    ]
    expect(applyLogFloors(cols, floored, true)).toEqual([
      [10, 20, 30, 40],
      [1, 1, 1, 4.5e12]
    ])
  })
  it('preserves null (a geometry-nulled point stays a gap, not the floor)', () => {
    expect(
      applyLogFloors(
        [
          [1, 2],
          [null, 0]
        ],
        floored,
        true
      )
    ).toEqual([
      [1, 2],
      [null, 1]
    ])
  })
  it('does not mutate the input columns', () => {
    const cols = [
      [1, 2],
      [0, 5]
    ]
    applyLogFloors(cols, floored, true)
    expect(cols[1]).toEqual([0, 5])
  })
})

describe('niceLinearTicks', () => {
  it('places evenly-spaced round ticks inside [min, max]', () => {
    const ticks = niceLinearTicks(5105, 5170, 8)
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks[0]).toBeGreaterThanOrEqual(5105)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(5170)
    const step = ticks[1] - ticks[0]
    expect(ticks.every((t, i) => i === 0 || Math.abs(t - ticks[i - 1] - step) < 1e-6)).toBe(true)
  })

  it('returns a single value for a zero-width span', () => {
    expect(niceLinearTicks(42, 42, 8)).toEqual([42])
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

  it('preserves the chart data across a rebuild (scale toggle must not drop it)', async () => {
    // rebuild() reads uplot.data, destroys the old instance, and reconstructs with
    // that array. Guards the carry-over invariant behind PR-0 review finding #1: a
    // refactor that seeded [[]] or a uPlot upgrade whose destroy() mutated the data
    // would surface here rather than as a blank chart after a scale/mode toggle.
    const handle = await createChart(el, handleDef, {})
    const cols = [
      [1, 2, 3],
      [10, 20, 30]
    ]
    handle.setData(cols)
    const before = handle.uplot
    handle.setScaleType('log') // forces a destroy + reconstruct
    expect(handle.uplot).not.toBe(before) // genuinely a fresh instance...
    expect(handle.uplot.data).toEqual(cols) // ...carrying the same data forward
    handle.setScaleType('linear') // a second rebuild
    expect(handle.uplot.data).toEqual(cols) // still intact
  })

  it('applies a series logFloor only on log, and re-derives it across a scale toggle', async () => {
    // The clamp must follow the CURRENT scale through rebuilds — a scale toggle reuses
    // stored raw data, so a toColumns-time clamp would go stale. The adapter re-derives
    // from the raw columns on every (re)build.
    const floorDef = {
      name: 'coin-supply/1',
      label: 'SKA1',
      axes: [{ label: 'SKA1', scale: 'y' }],
      series: [{ label: 'Coin Supply', scale: 'y', kind: 'line', logFloor: 1 }]
    }
    const handle = await createChart(el, floorDef, {}) // defaults to linear
    const cols = [
      [1, 2, 3],
      [0, 0, 5]
    ]
    handle.setData(cols)
    expect(handle.uplot.data[1]).toEqual([0, 0, 5]) // linear: raw, unclamped
    handle.setScaleType('log')
    expect(handle.uplot.data[1]).toEqual([1, 1, 5]) // log: zeros raised to the floor
    handle.setScaleType('linear')
    expect(handle.uplot.data[1]).toEqual([0, 0, 5]) // back to raw on linear
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

  it('setDark rebuilds with the new theme colors and destroys the old instance', async () => {
    const handle = await createChart(el, handleDef, { dark: false })
    const first = handle.uplot
    expect(first.opts.axes[0].stroke).toBe('#2d2d2d') // light-theme axis color
    handle.setDark(true)
    expect(first.destroy).toHaveBeenCalled()
    expect(handle.uplot).not.toBe(first)
    expect(handle.uplot.opts.axes[0].stroke).toBe('#b6b6b6') // dark-theme axis color
  })

  it('setDark is a no-op when already at the requested theme', async () => {
    const handle = await createChart(el, handleDef, { dark: true })
    const first = handle.uplot
    handle.setDark(true)
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

describe('ChartHandle x-range ownership + onRangeChange (Approach A foundation)', () => {
  const el = {}
  // uPlot fires setScale on a microtask; let those (and the adapter's microtask-queued
  // suppress-flag clear) drain before asserting.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('emits onRangeChange when uPlot changes the x-scale (user drag/double-click)', async () => {
    const onRangeChange = vi.fn()
    const handle = await createChart(el, handleDef, { onRangeChange })
    // uPlot performs the scale change internally on a drag-zoom or double-click;
    // simulate that by changing the x-scale outside the adapter's own methods.
    handle.uplot.setScale('x', { min: 5, max: 15 })
    await flush()
    expect(onRangeChange).toHaveBeenCalledWith(5, 15)
  })

  it('does not emit onRangeChange for a programmatic setXRange', async () => {
    const onRangeChange = vi.fn()
    const handle = await createChart(el, handleDef, { onRangeChange })
    handle.setXRange(10, 20)
    await flush()
    expect(onRangeChange).not.toHaveBeenCalled()
  })

  it('does not emit onRangeChange when setData autoscales (load-time false positive)', async () => {
    const onRangeChange = vi.fn()
    const handle = await createChart(el, handleDef, { onRangeChange })
    handle.setData([
      [1, 2, 3],
      [10, 20, 30]
    ])
    await flush()
    expect(onRangeChange).not.toHaveBeenCalled()
  })

  it('remembers a user zoom and restores it across a rebuild', async () => {
    const handle = await createChart(el, handleDef, {})
    handle.uplot.setScale('x', { min: 5, max: 15 }) // user drag-zoom
    await flush() // let the setScale hook record the new range
    handle.setScaleType('log') // forces a rebuild
    expect(handle.uplot.setScale).toHaveBeenCalledWith('x', { min: 5, max: 15 })
  })

  it('stays quiet while the rebuild restores the remembered range', async () => {
    const onRangeChange = vi.fn()
    const handle = await createChart(el, handleDef, { onRangeChange })
    handle.uplot.setScale('x', { min: 5, max: 15 }) // user zoom -> 1 emit
    await flush()
    onRangeChange.mockClear()
    handle.setScaleType('log') // rebuild re-applies the range — must not re-emit
    await flush()
    expect(onRangeChange).not.toHaveBeenCalled()
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

describe('buildOpts — threeSigFigs axis tick formatter', () => {
  it('y-axis values fn formats using threeSigFigs, trimming filler zeros', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    expect(yAxis.values(null, [1000, 12000, 1500000])).toEqual(['1k', '12k', '1.5M'])
  })
  it('drops the decimal part on whole-number y-axis ticks', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    expect(yAxis.values(null, [25, 50, 75])).toEqual(['25', '50', '75'])
  })
  it('height x-axis values fn formats using threeSigFigs, trimming filler zeros', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: false })
    expect(opts.axes[0].values(null, [1000, 12000, 1500000])).toEqual(['1k', '12k', '1.5M'])
  })
  it('time x-axis carries a fmtDate stamp config (array of arrays)', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    // An array whose first element is itself an array → uPlot reads it as a
    // per-zoom-level fmtDate stamp config rather than static tick values.
    expect(Array.isArray(opts.axes[0].values)).toBe(true)
    expect(Array.isArray(opts.axes[0].values[0])).toBe(true)
  })
  it('y-axis handles null splits gracefully', () => {
    const opts = buildOpts(fakeUPlot, lineDef, {})
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    expect(yAxis.values(null, [null, 1000])).toEqual(['', '1k'])
  })
})

describe('buildOpts — time x-axis date format ("01 Jun", not "6/1")', () => {
  // The x scale is in seconds (opts.ms defaults to 1e-3), so the stamp thresholds
  // are seconds: a day = 86400, ~a month = 86400*28. uPlot compiles each stamp's
  // fmtDate template internally; here we compile the raw templates directly to
  // assert the exact rendered labels.
  const stampFor = (opts, incrSecs) => opts.axes[0].values.find((r) => r[0] === incrSecs)

  it('renders day-level ticks as "01 Jun", never "6/1"', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    const fmt = uPlot.fmtDate(stampFor(opts, 86400)[1])
    expect(fmt(new Date(2024, 5, 1))).toBe('01 Jun') // month index 5 = June
    expect(fmt(new Date(2024, 11, 9))).toBe('09 Dec')
  })

  it('rolls the year onto the day label as "01 Jun\\n2024" at a year boundary', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    // mode 1 concatenates the default ([1]) with the year-rollover template ([2]).
    const day = stampFor(opts, 86400)
    const fmt = uPlot.fmtDate(day[1] + day[2])
    expect(fmt(new Date(2024, 0, 1))).toBe('01 Jan\n2024')
  })

  it('renders month-level ticks as the short month name', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    expect(uPlot.fmtDate(stampFor(opts, 86400 * 28)[1])(new Date(2024, 5, 1))).toBe('Jun')
  })

  it('renders year-level ticks as the 4-digit year', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    expect(uPlot.fmtDate(stampFor(opts, 86400 * 365)[1])(new Date(2024, 5, 1))).toBe('2024')
  })

  it('renders hour-level ticks in 24-hour time as "22:00", not "10pm"', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    const fmt = uPlot.fmtDate(stampFor(opts, 3600)[1])
    expect(fmt(new Date(2024, 5, 1, 22, 0))).toBe('22:00')
    expect(fmt(new Date(2024, 5, 1, 9, 0))).toBe('09:00')
  })

  it('renders minute-level ticks in 24-hour time as "22:05"', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: true })
    expect(uPlot.fmtDate(stampFor(opts, 60)[1])(new Date(2024, 5, 1, 22, 5))).toBe('22:05')
  })

  it('leaves the height (non-time) x-axis on the numeric formatter', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { xTime: false })
    expect(opts.axes[0].values(null, [1000, 12000])).toEqual(['1k', '12k'])
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

describe('buildOpts — colorIndex 0 is theme-aware (primary series)', () => {
  it('keeps the index-0 line blue in light mode', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { dark: false })
    expect(opts.series[1].stroke).toBe('#2970FF')
  })

  it('swaps the index-0 line to mint in dark mode', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { dark: true })
    expect(opts.series[1].stroke).toBe('#2DD8A3')
  })

  it('matches the y-axis stroke to the dark primary series color', () => {
    const opts = buildOpts(fakeUPlot, lineDef, { dark: true })
    const yAxis = opts.axes.find((a) => a.scale === 'y')
    expect(yAxis.stroke).toBe('#2DD8A3')
  })

  it('colors the index-0 area fill from the dark primary', () => {
    const areaDef = { ...lineDef, series: [{ label: 'Difficulty', scale: 'y', kind: 'area' }] }
    const opts = buildOpts(fakeUPlot, areaDef, { dark: true })
    expect(opts.series[1].fill).toBe('rgba(45, 216, 163, 0.18)') // mint @ dark alpha
  })

  it('leaves a colorKey series unaffected by the dark threading (still SERIES_COLORS mint)', () => {
    const colorKeyDef = {
      ...lineDef,
      series: [{ label: 'Price', scale: 'y', kind: 'line', colorKey: 'tickets-price' }]
    }
    const opts = buildOpts(fakeUPlot, colorKeyDef, { dark: true })
    expect(opts.series[1].stroke).toBe('#2dd8a3') // from SERIES_COLORS, not colorForIndex
  })
})

describe('stack (uPlot stacking transform)', () => {
  const none = () => false

  it('accumulates each series into a running per-row total', () => {
    const cols = [
      [1, 2, 3], // xs
      [10, 20, 30], // s1
      [1, 2, 3], // s2
      [100, 200, 300] // s3
    ]
    const { data } = stack(cols, none)
    expect(data[0]).toEqual([1, 2, 3]) // xs untouched
    expect(data[1]).toEqual([10, 20, 30]) // s1 = s1
    expect(data[2]).toEqual([11, 22, 33]) // s2 = s1 + s2
    expect(data[3]).toEqual([111, 222, 333]) // s3 = s1 + s2 + s3
  })

  it('emits bands linking each series to the next one above it', () => {
    const cols = [[1], [1], [1], [1]]
    const { bands } = stack(cols, none)
    // series indices are 1-based uPlot data indices
    expect(bands).toEqual([{ series: [2, 1] }, { series: [3, 2] }])
  })

  it('omits a hidden series from accumulation AND from bands', () => {
    const cols = [
      [1, 2],
      [10, 10], // s1 visible
      [5, 5], // s2 HIDDEN
      [1, 1] // s3 visible
    ]
    const omit = (i) => i === 2
    const { data, bands } = stack(cols, omit)
    expect(data[1]).toEqual([10, 10]) // s1
    expect(data[2]).toEqual([5, 5]) // s2 passed through unchanged (hidden, not drawn)
    expect(data[3]).toEqual([11, 11]) // s3 = s1 + s3 (s2 skipped)
    expect(bands).toEqual([{ series: [3, 1] }]) // s1 fills up to s3, s2 skipped
  })

  it('treats null/NaN as 0 in the total but keeps the gap in its own column', () => {
    const cols = [
      [1, 2],
      [10, null],
      [1, 2]
    ]
    const { data } = stack(cols, none)
    expect(data[1]).toEqual([10, null]) // own column keeps the gap
    expect(data[2]).toEqual([11, 2]) // null counted as 0 in the running total
  })
})

describe('buildOpts stacking', () => {
  const def = {
    name: 'flow',
    label: 'Flow',
    stacked: true,
    axes: [{ label: 'Total', scale: 'y' }],
    series: [
      { label: 'A', scale: 'y', kind: 'bars', colorIndex: 0 },
      { label: 'B', scale: 'y', kind: 'bars', colorIndex: 1 },
      { label: 'C', scale: 'y', kind: 'bars', colorIndex: 2 }
    ]
  }

  it('emits consecutive bands when all series are visible', () => {
    const opts = buildOpts(fakeUPlot, def, {})
    expect(opts.bands).toEqual([{ series: [2, 1] }, { series: [3, 2] }])
  })

  it('skips a hidden series when computing bands', () => {
    const opts = buildOpts(fakeUPlot, def, { visibility: { B: false } })
    expect(opts.bands).toEqual([{ series: [3, 1] }])
  })

  it('omits bands entirely for a non-stacked def', () => {
    const opts = buildOpts(fakeUPlot, { ...def, stacked: false }, {})
    expect(opts.bands).toBeUndefined()
  })
})

describe('createChart stacking', () => {
  const def = {
    name: 'flow',
    label: 'Flow',
    stacked: true,
    axes: [{ label: 'Total', scale: 'y' }],
    series: [
      { label: 'A', scale: 'y', kind: 'bars', colorIndex: 0 },
      { label: 'B', scale: 'y', kind: 'bars', colorIndex: 1 }
    ]
  }
  let el
  beforeEach(() => {
    el = document.createElement('div')
  })

  it('plots cumulative columns for a stacked def', async () => {
    const handle = await createChart(el, def, {})
    handle.setData([
      [1, 2],
      [10, 20],
      [1, 2]
    ])
    // last setData call on the fake records the data it received
    const plotted = handle.uplot.data
    expect(plotted[1]).toEqual([10, 20]) // A
    expect(plotted[2]).toEqual([11, 22]) // B = A + B (cumulative)
  })

  it('rebuilds and restacks when a series is hidden', async () => {
    const handle = await createChart(el, def, {})
    handle.setData([[1], [10], [5]])
    const before = handle.uplot
    handle.setVisibility({ A: false })
    expect(handle.uplot).not.toBe(before) // rebuilt
    // A omitted → B no longer adds A; B column = 5 (its own value, A excluded)
    expect(handle.uplot.data[2]).toEqual([5])
    // hidden series is also setSeries(show:false)
    expect(handle.uplot.setSeries).toHaveBeenCalledWith(1, { show: false })
  })
})
