import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestJSON } from '../helpers/http'

const mockReplace = vi.fn()

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../helpers/turbolinks_helper', () => {
  return {
    default: class TurboQuery {
      constructor() {
        this.url = {
          protocol: 'https:',
          host: 'localhost',
          set: vi.fn(),
          query: {}
        }
        this.update = vi.fn()
      }
      replace(query) {
        mockReplace(query)
      }
      static nullTemplate(keys) {
        const d = {}
        keys.forEach((k) => (d[k] = null))
        return d
      }
    }
  }
})

vi.mock('../helpers/http', () => ({
  requestJSON: vi.fn().mockResolvedValue({
    t: [1000, 2000],
    price: [10, 20],
    count: [100, 200],
    h: [1, 2],
    supply: [1000, 2000],
    fees: [1, 2],
    duration: [10, 20],
    work: [100, 200],
    rate: [100, 200],
    missed: [1, 2],
    offset: 0,
    axis: 'time',
    bin: 'block'
  })
}))

vi.mock('../services/event_bus_service', () => ({
  default: {
    on: vi.fn(),
    off: vi.fn()
  }
}))

vi.mock('../services/theme_service', () => ({
  darkEnabled: vi.fn().mockReturnValue(false)
}))

vi.mock('../helpers/module_helper', () => ({
  getDefault: vi.fn().mockResolvedValue(
    class Dygraph {
      constructor() {
        this.plotter_ = { clear: vi.fn() }
        this.updateOptions = vi.fn()
        this.xAxisExtremes = vi.fn().mockReturnValue([0, 100])
        this.yAxisRanges = vi.fn().mockReturnValue([0, 100])
      }
      static Plugins = {
        Legend: {
          generateLegendHTML: vi.fn()
        }
      }
    }
  )
}))

vi.mock('../helpers/zoom_helper', () => ({
  default: {
    validate: vi.fn().mockReturnValue({ start: 0, end: 100 }),
    project: vi.fn().mockReturnValue({ start: 0, end: 100 }),
    object: vi.fn().mockReturnValue({ start: 0, end: 100 }),
    encode: vi.fn().mockReturnValue('zoom-string'),
    mapKey: vi.fn().mockReturnValue('zoom-option')
  }
}))

vi.mock('../helpers/animation_helper', () => ({
  animationFrame: vi.fn().mockResolvedValue()
}))

vi.mock('../helpers/chart_helper', () => ({
  isEqual: vi.fn().mockReturnValue(false)
}))

const {
  default: ChartsController,
  sanitizeLogValueRange,
  clampLogFloor
} = await import('./charts_controller.js')

function makeController() {
  const c = new ChartsController()
  c.data = { get: vi.fn().mockReturnValue('100') }
  c.chartSelectTarget = { value: 'ticket-price' }
  c.chartWrapperTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.scaleSelectorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.vSelectorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.vSelectorItemTargets = []
  c.modeSelectorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.binSelectorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.binSizeTargets = []
  c.axisOptionTargets = []
  c.zoomOptionTargets = []
  c.scaleTypeTargets = []
  c.modeOptionTargets = []
  c.labelsTarget = { appendChild: vi.fn() }
  c.legendMarkerTarget = { remove: vi.fn(), removeAttribute: vi.fn() }
  c.legendEntryTarget = { remove: vi.fn(), removeAttribute: vi.fn() }
  c.rawDataURLTarget = { textContent: '' }
  c.chartsViewTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.ticketsPriceTarget = { checked: true }
  c.ticketsPurchaseTarget = { checked: true }
  c.hashrateRateTarget = { checked: true }
  c.hashrateMinersTarget = { checked: true }
  c.intervalSelectorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.intervalOptionTargets = []
  return c
}

describe('ChartsController URL persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selectChart persists chart/bin/axis to URL via query.replace', async () => {
    const c = makeController()
    await c.connect()

    c.chartSelectTarget.value = 'ticket-pool-size'

    // Mock DOM for selected options
    c.binSizeTargets = [
      {
        classList: { contains: (cls) => cls === 'active', add: vi.fn(), remove: vi.fn() },
        dataset: { option: 'day' }
      }
    ]
    c.axisOptionTargets = [
      {
        classList: { contains: (cls) => cls === 'active', add: vi.fn(), remove: vi.fn() },
        dataset: { option: 'time' }
      }
    ]

    await c.selectChart()

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        chart: 'ticket-pool-size',
        bin: 'day',
        axis: 'time'
      })
    )
  })

  it('setBin delegates to selectChart and persists bin to URL', async () => {
    const c = makeController()
    await c.connect()

    c.chartSelectTarget.value = 'ticket-pool-size' // Use chart that supports blocks

    const binOption = {
      classList: { contains: (cls) => cls === 'active', add: vi.fn(), remove: vi.fn() },
      dataset: { option: 'block' }
    }
    c.binSizeTargets = [binOption]
    c.axisOptionTargets = [
      {
        classList: { contains: (cls) => cls === 'active', add: vi.fn(), remove: vi.fn() },
        dataset: { option: 'time' }
      }
    ]

    const event = { target: binOption }
    await c.setBin(event)

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'block'
      })
    )
  })

  it('setAxis delegates to selectChart and persists axis to URL', async () => {
    const c = makeController()
    await c.connect()

    const axisOption = {
      classList: { contains: (cls) => cls === 'active', add: vi.fn(), remove: vi.fn() },
      dataset: { option: 'height' }
    }
    c.axisOptionTargets = [axisOption]
    c.binSizeTargets = [
      {
        classList: { contains: (cls) => cls === 'active', add: vi.fn(), remove: vi.fn() },
        dataset: { option: 'day' }
      }
    ]

    const event = { target: axisOption }
    await c.setAxis(event)

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        axis: 'height'
      })
    )
  })
})

describe('ChartsController hashrate chart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selecting hashrate adds chart-hashrate class to chartview', async () => {
    const c = makeController()
    await c.connect()

    c.chartSelectTarget.value = 'hashrate'
    await c.selectChart()

    expect(c.chartsViewTarget.classList.add).toHaveBeenCalledWith('chart-hashrate')
  })

  it('switching away from hashrate removes chart-hashrate class', async () => {
    const c = makeController()
    await c.connect()

    c.chartSelectTarget.value = 'hashrate'
    await c.selectChart()

    c.chartSelectTarget.value = 'ticket-price'
    await c.selectChart()

    expect(c.chartsViewTarget.classList.add).toHaveBeenCalledWith('chart-hashrate')
    expect(c.chartsViewTarget.classList.remove).toHaveBeenCalledWith('chart-hashrate')
  })
})

describe('sanitizeLogValueRange', () => {
  it('collapses a zero floor to null under log scale', () => {
    expect(sanitizeLogValueRange([0, null], true)).toEqual([null, null])
  })
  it('collapses a zero floor but preserves the upper bound under log scale', () => {
    expect(sanitizeLogValueRange([0, 100], true)).toEqual([null, 100])
  })
  it('collapses a negative floor to null under log scale', () => {
    expect(sanitizeLogValueRange([-5, 100], true)).toEqual([null, 100])
  })
  it('preserves a positive floor under log scale', () => {
    expect(sanitizeLogValueRange([5, 100], true)).toEqual([5, 100])
  })
  it('leaves a null floor unchanged under log scale', () => {
    expect(sanitizeLogValueRange([null, null], true)).toEqual([null, null])
  })
  it('does not modify the range in linear scale', () => {
    expect(sanitizeLogValueRange([0, null], false)).toEqual([0, null])
  })
  it('returns non-array input unchanged', () => {
    expect(sanitizeLogValueRange(undefined, true)).toBe(undefined)
  })
  it('returns a null range unchanged (a valid Dygraphs value)', () => {
    expect(sanitizeLogValueRange(null, true)).toBe(null)
  })
})

describe('clampLogFloor', () => {
  it('raises a zero value to the floor under log scale', () => {
    expect(clampLogFloor(0, true)).toBe(1)
  })
  it('raises a sub-floor positive value to the floor under log scale', () => {
    expect(clampLogFloor(0.5, true)).toBe(1)
  })
  it('leaves a value at the floor unchanged', () => {
    expect(clampLogFloor(1, true)).toBe(1)
  })
  it('leaves a value above the floor unchanged under log scale', () => {
    expect(clampLogFloor(5000000, true)).toBe(5000000)
  })
  it('does not clamp in linear scale', () => {
    expect(clampLogFloor(0, false)).toBe(0)
    expect(clampLogFloor(0.5, false)).toBe(0.5)
  })
  it('accepts a custom floor', () => {
    expect(clampLogFloor(3, true, 10)).toBe(10)
  })
})

describe('ChartsController coin-supply SKA log floor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const skaData = () => ({
    t: [1000, 2000, 3000],
    supply: ['0', '0', '5000000000000000000000000']
  })

  async function plotSka(scale) {
    const c = makeController()
    await c.connect()
    c.settings.scale = scale
    c.settings.axis = 'time'
    c.settings.bin = 'block'
    c.settings.interval = 'week'
    c.chartsView.updateOptions.mockClear()
    c.plotGraph('coin-supply/2', skaData())
    const call = c.chartsView.updateOptions.mock.calls.find((args) => args[1] === false)
    expect(call).toBeTruthy()
    return { c: c, file: call[0].file }
  }

  it('clamps zero/pre-mint SKA supply points up to the floor (1) in log scale', async () => {
    const { file } = await plotSka('log')
    expect(file[0][1]).toBe(1) // pre-mint 0 clamped to floor
    expect(file[1][1]).toBe(1)
    // real value untouched (toBeCloseTo: SKA atoms exceed float precision, so
    // the line is inherently lossy — exactly why the legend uses raw strings)
    expect(file[2][1]).toBeCloseTo(5000000, 0)
  })

  it('does not clamp SKA supply points in linear scale', async () => {
    const { file } = await plotSka('linear')
    expect(file[0][1]).toBe(0)
    expect(file[2][1]).toBeCloseTo(5000000, 0)
  })

  it('keeps the exact SKA atom strings for the legend (clamp is line-only)', async () => {
    const { c } = await plotSka('log')
    expect(c._skaSupplyRaw).toEqual(['0', '0', '5000000000000000000000000'])
  })
})

describe('ChartsController plotGraph log-axis guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collapses the duration y-axis floor to null in log scale', async () => {
    const c = makeController()
    await c.connect()
    c.settings.scale = 'log'
    c.settings.axis = 'time'
    c.settings.bin = 'block'
    c.settings.interval = 'week'
    c.chartsView.updateOptions.mockClear()

    c.plotGraph('duration-btw-blocks', { t: [1000, 2000], duration: [10, 20] })

    const call = c.chartsView.updateOptions.mock.calls.find((args) => args[1] === false)
    expect(call).toBeTruthy()
    const gOptions = call[0]
    expect(gOptions.logscale).toBe(true)
    expect(gOptions.axes.y.valueRange).toEqual([null, null])
  })

  it('preserves the hashrate y2 floor in log scale (y2 stays linear)', async () => {
    const c = makeController()
    await c.connect()
    c.settings.scale = 'log'
    c.settings.axis = 'time'
    c.settings.bin = 'block'
    c.settings.interval = 'week'
    c.chartsView.updateOptions.mockClear()

    c.plotGraph('hashrate', {
      t: [1000, 2000],
      rate: [100, 200],
      active_miners: [3, 4],
      offset: 0
    })

    const call = c.chartsView.updateOptions.mock.calls.find((args) => args[1] === false)
    expect(call).toBeTruthy()
    const gOptions = call[0]
    expect(gOptions.axes.y.valueRange).toEqual([null, null]) // primary y unbounded
    expect(gOptions.axes.y2.valueRange).toEqual([0, null]) // y2 floor untouched
  })

  it('caches the chart name and data for re-plotting', async () => {
    const c = makeController()
    await c.connect()
    c.settings.scale = 'linear'
    c.settings.axis = 'time'
    c.settings.bin = 'block'
    c.settings.interval = 'week'
    const data = { t: [1000, 2000], duration: [10, 20] }

    c.plotGraph('duration-btw-blocks', data)

    expect(c.rawChartName).toBe('duration-btw-blocks')
    expect(c.rawChartData).toBe(data)
  })
})

describe('ChartsController setScale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-plots from cached data with the new scale applied before plotting', async () => {
    const c = makeController()
    await c.connect()
    c.rawChartName = 'duration-btw-blocks'
    c.rawChartData = { t: [1000, 2000], duration: [10, 20] }
    let scaleAtPlot
    const plotSpy = vi.spyOn(c, 'plotGraph').mockImplementation(() => {
      scaleAtPlot = c.settings.scale
    })
    plotSpy.mockClear()

    c.setScale({ target: { dataset: { option: 'log' } } })

    expect(c.settings.scale).toBe('log')
    expect(plotSpy).toHaveBeenCalledTimes(1)
    expect(plotSpy).toHaveBeenCalledWith('duration-btw-blocks', c.rawChartData)
    expect(scaleAtPlot).toBe('log') // scale set BEFORE plotGraph runs
  })

  it('does not trigger a network re-fetch on a scale toggle', async () => {
    const c = makeController()
    await c.connect()
    c.rawChartName = 'missed-votes'
    c.rawChartData = { t: [1000, 2000], missed: [0, 2] }
    vi.spyOn(c, 'plotGraph').mockImplementation(() => {})
    vi.mocked(requestJSON).mockClear()

    c.setScale({ target: { dataset: { option: 'log' } } })

    expect(requestJSON).not.toHaveBeenCalled()
  })

  it('falls back to updateOptions when no chart data is cached', async () => {
    const c = makeController()
    await c.connect()
    c.rawChartData = null
    c.chartsView.updateOptions.mockClear()

    c.setScale({ target: { dataset: { option: 'log' } } })

    expect(c.chartsView.updateOptions).toHaveBeenCalledWith({ logscale: true })
  })

  // End-to-end guard: the other setScale tests stub plotGraph, so they verify the
  // wiring (scale set first, right args, no re-fetch) but not that toggling to log
  // actually re-applies the log-axis guard. This drives the REAL plotGraph through
  // a scale toggle and asserts the stale [0, null] floor collapses to [null, null].
  it('re-applies the log-axis guard through a real re-plot on toggle', async () => {
    const c = makeController()
    await c.connect()
    c.settings.scale = 'linear'
    c.settings.axis = 'time'
    c.settings.bin = 'block'
    c.settings.interval = 'week'

    // Plot once in linear to populate the cache; the floor stays [0, null] here.
    // Clear first so the find() below matches this plot, not connect()'s.
    c.chartsView.updateOptions.mockClear()
    c.plotGraph('duration-btw-blocks', { t: [1000, 2000], duration: [10, 20] })
    const linearCall = c.chartsView.updateOptions.mock.calls.find((args) => args[1] === false)
    expect(linearCall[0].axes.y.valueRange).toEqual([0, null])

    c.chartsView.updateOptions.mockClear()
    c.setScale({ target: { dataset: { option: 'log' } } })

    const logCall = c.chartsView.updateOptions.mock.calls.find((args) => args[1] === false)
    expect(logCall).toBeTruthy()
    expect(logCall[0].logscale).toBe(true)
    expect(logCall[0].axes.y.valueRange).toEqual([null, null]) // guard reapplied
  })
})
