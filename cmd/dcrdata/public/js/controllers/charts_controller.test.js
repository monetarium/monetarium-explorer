import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// Fake ChartHandle the adapter returns.
const fakeHandle = {
  uplot: { setScale: vi.fn(), data: [[]], scales: { x: {} }, cursor: {} },
  setData: vi.fn(),
  setScaleType: vi.fn(),
  setMode: vi.fn(),
  setVisibility: vi.fn(),
  setXRange: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn()
}

vi.mock('../helpers/uplot_adapter', () => ({
  createChart: vi.fn().mockResolvedValue(fakeHandle),
  createSyncKey: (n) => `mon-chart-sync:${n}`
}))

// Side-effect barrel is a no-op import in tests; stub it.
vi.mock('../charts/definitions/index', () => ({}))

// Controllable definition resolution.
vi.mock('../charts/registry', () => ({
  getDefinition: vi.fn((name) => ({
    name: name,
    label: name,
    controls: {
      bin: true,
      scale: true,
      mode: name === 'ticket-price' || name === 'hashrate',
      zoom: true,
      visibility: name === 'hashrate' ? ['Hashrate', 'Active Miners'] : null,
      interval: name === 'hashrate',
      windowUnits: name === 'ticket-price',
      hybrid: false
    },
    axes: [{ label: name, scale: 'y' }],
    series: [{ label: name, scale: 'y', kind: 'line', colorIndex: 0 }],
    toColumns: () => [
      [1, 2],
      [10, 20]
    ],
    formatValue: (_i, d) => String(d.value)
  })),
  coinTypeFromName: () => 0,
  isCoinSupplyName: () => false,
  isSKAFeeName: () => false
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

const { default: ChartsController } = await import('./charts_controller.js')

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
  c.chartsViewTarget = {
    classList: { add: vi.fn(), remove: vi.fn() },
    clientWidth: 800,
    clientHeight: 400
  }
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

  // TODO Task 18: unskip once applyControlVisibility adds chart-hashrate
  it.skip('selecting hashrate adds chart-hashrate class to chartview', async () => {
    const c = makeController()
    await c.connect()

    c.chartSelectTarget.value = 'hashrate'
    await c.selectChart()

    expect(c.chartsViewTarget.classList.add).toHaveBeenCalledWith('chart-hashrate')
  })

  // TODO Task 18: unskip once applyControlVisibility adds chart-hashrate
  it.skip('switching away from hashrate removes chart-hashrate class', async () => {
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
