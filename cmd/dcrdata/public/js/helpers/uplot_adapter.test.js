import { describe, it, expect } from 'vitest'
import { buildOpts } from './uplot_adapter'

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
