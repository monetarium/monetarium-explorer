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

const { default: ChartsController, sanitizeLogValueRange } = await import('./charts_controller.js')

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
