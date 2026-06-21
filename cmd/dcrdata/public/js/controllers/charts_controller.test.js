import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockReplace = vi.fn()
let restoreSettings = null

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
      }
      update(target) {
        if (restoreSettings) Object.assign(target, restoreSettings)
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
  setDark: vi.fn(),
  setVisibility: vi.fn(),
  setXRange: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn()
}

vi.mock('../helpers/uplot_adapter', () => ({
  createChart: vi.fn().mockResolvedValue(fakeHandle),
  createSyncKey: (n) => `mon-chart-sync:${n}`,
  resolveSeriesColor: vi.fn(() => 'rgb(45, 179, 94)')
}))

const fakeRanger = {
  uplot: {},
  setData: vi.fn(),
  setSelection: vi.fn(),
  setGutters: vi.fn(),
  setWidth: vi.fn(),
  setDark: vi.fn(),
  destroy: vi.fn()
}
let capturedRangerOpts = null
vi.mock('../helpers/uplot_ranger', () => ({
  createRanger: vi.fn((el, def, opts) => {
    capturedRangerOpts = opts
    return Promise.resolve(fakeRanger)
  })
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

vi.mock('../helpers/zoom_helper', () => {
  // Real preset spans (ms) so presetForRange/zoomSpan match, plus faithful base-36
  // encode/decode so the encoded-range round-trip is exercised for real.
  const zoomMap = { all: 0, year: 3.154e10, month: 2.628e9, week: 6.048e8, day: 8.64e7 }
  return {
    default: {
      validate: vi.fn().mockReturnValue({ start: 0, end: 100 }),
      project: vi.fn().mockReturnValue({ start: 0, end: 100 }),
      object: vi.fn().mockReturnValue({ start: 0, end: 100 }),
      encode: vi.fn((s, e) => `${parseInt(s).toString(36)}-${parseInt(e).toString(36)}`),
      decode: vi.fn((enc) => {
        if (typeof enc === 'string' && enc.indexOf('-') !== -1) {
          const [a, b] = enc.split('-')
          return { start: parseInt(a, 36), end: parseInt(b, 36) }
        }
        return enc
      }),
      mapKey: vi.fn().mockReturnValue('zoom-option'),
      mapValue: vi.fn((key) => zoomMap[key])
    }
  }
})

vi.mock('../helpers/animation_helper', () => ({
  animationFrame: vi.fn().mockResolvedValue()
}))

const { default: ChartsController } = await import('./charts_controller.js')

function optBtn(option, active = false) {
  let on = active
  return {
    dataset: { option },
    classList: {
      add: (c) => {
        if (c === 'active') on = true
      },
      remove: (c) => {
        if (c === 'active') on = false
      },
      contains: (c) => c === 'active' && on
    }
  }
}

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
  c.labelsTarget = {
    classList: { add: vi.fn(), remove: vi.fn() },
    replaceChildren: vi.fn(),
    appendChild: vi.fn()
  }
  c.legendMarkerTarget = {
    remove: vi.fn(),
    removeAttribute: vi.fn(),
    cloneNode: vi.fn().mockImplementation(() => document.createElement('span'))
  }
  c.legendEntryTarget = {
    remove: vi.fn(),
    removeAttribute: vi.fn(),
    cloneNode: vi.fn().mockImplementation(() => {
      const node = {
        innerHTML: '',
        get textContent() {
          return this.innerHTML
        }
      }
      return node
    })
  }
  c.rawDataURLTarget = { textContent: '' }
  c.chartsViewTarget = {
    classList: { add: vi.fn(), remove: vi.fn() },
    clientWidth: 800,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 0 }),
    listeners: {},
    addEventListener: vi.fn(function (type, fn) {
      this.listeners[type] = fn
    }),
    removeEventListener: vi.fn(function (type) {
      delete this.listeners[type]
    })
  }
  c.ticketsPriceTarget = { checked: true }
  c.ticketsPurchaseTarget = { checked: true }
  c.hashrateRateTarget = { checked: true }
  c.hashrateMinersTarget = { checked: true }
  c.intervalSelectorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.intervalOptionTargets = []
  c.hasRangerViewTarget = true
  c.rangerViewTarget = { clientWidth: 800 }
  return c
}

describe('ChartsController URL persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
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

  it('selectChart populates rawDataURLTarget with the chart API URL', async () => {
    const c = makeController()
    await c.connect()

    expect(c.rawDataURLTarget.textContent).toContain('/api/chart/')
    expect(c.rawDataURLTarget.textContent).toContain(c.chartSelectTarget.value)
  })

  it('connect restores bookmarked bin/axis active state from URL params', async () => {
    restoreSettings = { chart: 'ticket-pool-size', bin: 'block', axis: 'height' }
    const c = makeController()
    c.binSizeTargets = [optBtn('day', true), optBtn('block')]
    c.axisOptionTargets = [optBtn('time', true), optBtn('height')]

    await c.connect()

    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({ bin: 'block', axis: 'height' })
    )
  })
})

describe('ChartsController legend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renderLegend writes one entry per series plus the x label', async () => {
    const c = makeController()
    // legend element collects appended children's text
    const appended = []
    c.labelsTarget = {
      classList: { add: vi.fn(), remove: vi.fn() },
      innerHTML: '',
      appendChild: (node) => appended.push(node.textContent),
      replaceChildren: () => (appended.length = 0)
    }
    await c.connect()
    c.currentDef = {
      name: 'demo',
      series: [{ label: 'Price' }],
      formatValue: (i, d) => `${d.value} VAR`
    }
    c.payload = { t: [1000, 2000], axis: 'time' }
    c.settings.axis = 'time'

    const u = {
      cursor: { idx: 1 },
      data: [
        [1000, 2000],
        [10, 20]
      ]
    }
    c.renderLegend(u)

    expect(appended.some((t) => t.includes('Price: 20 VAR'))).toBe(true)
  })

  it('renderLegend hides the legend when the cursor is off the plot', async () => {
    const c = makeController()
    c.labelsTarget = {
      classList: { add: vi.fn(), remove: vi.fn() },
      replaceChildren: vi.fn(),
      appendChild: vi.fn()
    }
    await c.connect()
    c.currentDef = { series: [], formatValue: () => '' }
    const u = { cursor: { idx: null }, data: [[1000]] }
    c.renderLegend(u)
    expect(c.labelsTarget.classList.add).toHaveBeenCalledWith('d-hide')
  })

  it('legendMarker colors the marker line with the given color, and omits it when none is given', async () => {
    const c = makeController()
    await c.connect()
    expect(c.legendMarker('rgb(224, 49, 49)')).toContain('border-bottom-color')
    expect(c.legendMarker()).not.toContain('border-bottom-color')
  })

  it('renderLegend colors each series marker with its resolved series stroke color', async () => {
    const { resolveSeriesColor } = await import('../helpers/uplot_adapter')
    const c = makeController()
    const appended = []
    c.labelsTarget = {
      classList: { add: vi.fn(), remove: vi.fn() },
      appendChild: (node) => appended.push(node.innerHTML),
      replaceChildren: () => (appended.length = 0)
    }
    await c.connect()
    const series = [{ label: 'Price', colorIndex: 2 }]
    c.currentDef = { name: 'demo', series: series, formatValue: (i, d) => `${d.value}` }
    c.payload = {}
    c.settings.axis = 'time'
    c.renderLegend({
      cursor: { idx: 1 },
      data: [
        [1000, 2000],
        [10, 20]
      ]
    })
    // marker color comes from the SAME resolver the adapter uses for the line stroke
    expect(resolveSeriesColor).toHaveBeenCalledWith(series[0], 0, false)
    expect(appended.some((h) => h.includes('border-bottom-color'))).toBe(true)
  })
})

describe('ChartsController on-plot tooltip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('installTooltip creates a tooltip in u.over and retargets the legend element', async () => {
    const c = makeController()
    await c.connect()
    const over = document.createElement('div')
    c.installTooltip({ over: over, cursor: {} })
    const tt = over.querySelector('.chart-tooltip')
    expect(tt).not.toBeNull()
    expect(c.legendElement).toBe(tt)
  })

  it('the tooltip shows on cursor enter and hides on leave', async () => {
    const c = makeController()
    await c.connect()
    const over = document.createElement('div')
    c.installTooltip({ over: over, cursor: {} })
    const tt = over.querySelector('.chart-tooltip')
    over.dispatchEvent(new Event('mouseenter')) // eslint-disable-line no-undef
    expect(tt.classList.contains('d-hide')).toBe(false)
    over.dispatchEvent(new Event('mouseleave')) // eslint-disable-line no-undef
    expect(tt.classList.contains('d-hide')).toBe(true)
  })

  it('renderLegend positions the tooltip near the cursor inside the overlay', async () => {
    const c = makeController()
    await c.connect()
    const over = document.createElement('div')
    Object.defineProperty(over, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(over, 'clientHeight', { value: 400, configurable: true })
    c.installTooltip({ over: over, cursor: {} })
    // legendElement is now a real <div>, so its real appendChild needs real nodes — the
    // makeController stub clones fake nodes. Override the entry generator for this test.
    c.legendEntry = (s) => {
      const d = document.createElement('div')
      d.textContent = s
      return d
    }
    c.currentDef = {
      name: 'demo',
      series: [{ label: 'Price' }],
      formatValue: (i, d) => `${d.value}`
    }
    c.payload = {}
    c.settings.axis = 'time'
    c.renderLegend({
      over: over,
      cursor: { idx: 1, left: 50, top: 30 },
      data: [
        [1000, 2000],
        [10, 20]
      ]
    })
    expect(c.legendElement.style.left).toBe('62px') // 50 + 12 pad, no flip (fits in 500)
    expect(c.legendElement.style.top).toBe('42px') // 30 + 12 pad, no flip (fits in 400)
  })
})

describe('ChartsController viewport fit', () => {
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  it('computeChartHeight fills the viewport below the chart top, reserving below-chart chrome', () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    expect(c.computeChartHeight()).toBe(628) // 1000 - 200 - 140 - 32
  })

  it('computeChartHeight clamps to the 320px readability floor on short viewports', () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true })
    expect(c.computeChartHeight()).toBe(320) // 500 - 200 - 140 - 32 = 128 -> floored to 320
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

describe('ChartsController control handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('setScale toggles the handle scale type and persists scale', async () => {
    const c = makeController()
    await c.connect()
    const scaleOpt = {
      classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
      dataset: { option: 'log' }
    }
    c.scaleTypeTargets = [scaleOpt]
    await c.setScale({ target: scaleOpt })
    expect(fakeHandle.setScaleType).toHaveBeenCalledWith('log')
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ scale: 'log' }))
  })

  it('setMode maps smooth to line on the handle and persists mode', async () => {
    const c = makeController()
    await c.connect()
    const modeOpt = {
      classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
      dataset: { option: 'smooth' }
    }
    c.modeOptionTargets = [modeOpt]
    c.setMode({ target: modeOpt })
    expect(fakeHandle.setMode).toHaveBeenCalledWith('line')
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ mode: 'smooth' }))
  })

  // The adapter calls onChartRangeChange on user drag-zoom / double-click reset.
  // These tests drive it directly with a known data extent on the fake handle.
  describe('onChartRangeChange (user drag-zoom / double-click)', () => {
    const withExtent = (c, min, max) => {
      fakeHandle.uplot.data = [
        [min, max],
        [10, 20]
      ]
    }

    it('maps a full-extent range (double-click reset) back to the "all" preset', async () => {
      restoreSettings = { chart: 'ticket-pool-size', zoom: 'week' }
      const c = makeController()
      const allBtn = optBtn('all')
      const weekBtn = optBtn('week', true)
      c.zoomOptionTargets = [allBtn, weekBtn]
      await c.connect()
      withExtent(c, 1000, 1000000)
      mockReplace.mockClear()

      c.onChartRangeChange(1000, 1000000)

      expect(c.settings.zoom).toBe('all')
      expect(allBtn.classList.contains('active')).toBe(true)
      expect(weekBtn.classList.contains('active')).toBe(false)
      expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ zoom: 'all' }))
      fakeHandle.uplot.data = [[]]
    })

    it('snaps a trailing week-wide window back to the "week" preset', async () => {
      const c = makeController()
      const allBtn = optBtn('all', true)
      const weekBtn = optBtn('week')
      c.zoomOptionTargets = [allBtn, weekBtn]
      await c.connect()
      const dataMax = 1000000
      withExtent(c, 1000, dataMax)
      mockReplace.mockClear()

      // week = 6.048e8 ms -> 604800 plot-seconds; a window of that span ending at dataMax.
      c.onChartRangeChange(dataMax - 604800, dataMax)

      expect(c.settings.zoom).toBe('week')
      expect(weekBtn.classList.contains('active')).toBe(true)
      fakeHandle.uplot.data = [[]]
    })

    it('persists a custom window as an encoded range and clears the presets', async () => {
      const c = makeController()
      const allBtn = optBtn('all', true)
      const weekBtn = optBtn('week')
      c.zoomOptionTargets = [allBtn, weekBtn]
      await c.connect()
      withExtent(c, 1000, 1000000)
      mockReplace.mockClear()

      c.onChartRangeChange(500000, 600000)

      // time axis: plot-seconds -> ms (x1000), base-36 encoded as start-end.
      const expected = `${(500000000).toString(36)}-${(600000000).toString(36)}`
      expect(c.settings.zoom).toBe(expected)
      expect(allBtn.classList.contains('active')).toBe(false)
      expect(weekBtn.classList.contains('active')).toBe(false)
      expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ zoom: expected }))
      fakeHandle.uplot.data = [[]]
    })
  })

  it('applyZoom restores an encoded range from the URL (clamped to the data)', async () => {
    const encoded = `${(500000000).toString(36)}-${(600000000).toString(36)}`
    restoreSettings = { chart: 'ticket-pool-size', zoom: encoded }
    const c = makeController()
    await c.connect()
    fakeHandle.uplot.data = [
      [1000, 1000000],
      [10, 20]
    ]
    fakeHandle.setXRange.mockClear()

    c.applyZoom()

    // ms -> plot-seconds (/1000), within [1000, 1000000] so applied verbatim.
    expect(fakeHandle.setXRange).toHaveBeenCalledWith(500000, 600000)
    fakeHandle.uplot.data = [[]]
  })

  it('renderChart rebuilds when series count changes', async () => {
    const { createChart } = await import('../helpers/uplot_adapter')
    const c = makeController()
    await c.connect()

    // First render: 1 series (already happened in connect)
    const callsAfterConnect = createChart.mock.calls.length

    // Simulate hashrate payload with active_miners (2 series) — override resolveRenderDef result
    // by giving the def 2 series so the guard fires.
    const twoPart = {
      name: 'hashrate',
      label: 'hashrate',
      controls: {
        bin: true,
        scale: true,
        mode: true,
        zoom: true,
        visibility: null,
        interval: false,
        windowUnits: false,
        hybrid: false
      },
      axes: [{ label: 'hashrate', scale: 'y' }],
      series: [
        { label: 'Hashrate', scale: 'y', kind: 'line', colorIndex: 0 },
        { label: 'Active Miners', scale: 'y2', kind: 'line', colorIndex: 1 }
      ],
      toColumns: () => [
        [1, 2],
        [10, 20],
        [5, 8]
      ],
      formatValue: (_i, d) => String(d.value)
    }
    c.payload = {}
    await c.renderChart(twoPart)

    // createChart must have been called again because series count went from 1 to 2
    expect(createChart.mock.calls.length).toBeGreaterThan(callsAfterConnect)
  })
})

describe('ChartsController ranger strip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
    capturedRangerOpts = null
    fakeHandle.uplot.data = [[]]
  })

  it('creates the ranger and feeds it the x + primary columns', async () => {
    const c = makeController()
    await c.connect()
    expect(fakeRanger.setData).toHaveBeenCalledWith([
      [1, 2],
      [10, 20]
    ])
    expect(typeof capturedRangerOpts.onSelect).toBe('function')
  })

  it('a strip drag persists a CUSTOM range and clears presets, even at a preset-width span', async () => {
    const c = makeController()
    const allBtn = optBtn('all', true)
    const weekBtn = optBtn('week')
    c.zoomOptionTargets = [allBtn, weekBtn]
    await c.connect()
    fakeHandle.uplot.data = [
      [1000, 1000000],
      [10, 20]
    ]
    mockReplace.mockClear()

    // A trailing week-wide window — onChartRangeChange would snap this to "week", but the
    // strip path must NOT snap.
    const dataMax = 1000000
    capturedRangerOpts.onSelect(dataMax - 604800, dataMax)

    expect(fakeHandle.setXRange).toHaveBeenCalledWith(dataMax - 604800, dataMax)
    expect(weekBtn.classList.contains('active')).toBe(false)
    expect(allBtn.classList.contains('active')).toBe(false)
    const expected = `${((dataMax - 604800) * 1000).toString(36)}-${(dataMax * 1000).toString(36)}`
    expect(c.settings.zoom).toBe(expected)
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ zoom: expected }))
  })

  it('a main-chart drag-zoom still snaps to a preset AND moves the strip selection', async () => {
    const c = makeController()
    const allBtn = optBtn('all', true)
    const weekBtn = optBtn('week')
    c.zoomOptionTargets = [allBtn, weekBtn]
    await c.connect()
    const dataMax = 1000000
    fakeHandle.uplot.data = [
      [1000, dataMax],
      [10, 20]
    ]
    mockReplace.mockClear()

    c.onChartRangeChange(dataMax - 604800, dataMax)

    expect(c.settings.zoom).toBe('week')
    expect(weekBtn.classList.contains('active')).toBe(true)
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(dataMax - 604800, dataMax)
  })

  it('clicking a preset moves the strip selection', async () => {
    const c = makeController()
    await c.connect()
    fakeHandle.uplot.data = [
      [1000, 1000000],
      [10, 20]
    ]
    const dayBtn = optBtn('day')
    c.zoomOptionTargets = [dayBtn]
    fakeRanger.setSelection.mockClear()

    c.setZoom({ target: dayBtn })

    expect(fakeRanger.setSelection).toHaveBeenCalled()
  })

  it('forwards a dark-mode flip to both charts and re-applies the captured x-range to the ranger', async () => {
    const c = makeController()
    await c.connect()
    fakeHandle.setDark.mockClear()
    fakeRanger.setDark.mockClear()
    fakeRanger.setSelection.mockClear()
    // The main chart has a committed x-range now...
    fakeHandle.uplot.scales.x = { min: 1000, max: 3000 }
    // ...but uPlot commits scale values on a microtask, so the rebuild inside setDark leaves
    // scales.x reading null synchronously. Model that, so the test fails if redrawTheme reads
    // the range AFTER the rebuild (null) instead of capturing it BEFORE.
    fakeHandle.setDark.mockImplementationOnce(() => {
      fakeHandle.uplot.scales.x = { min: null, max: null }
    })
    c.redrawTheme()
    await Promise.resolve() // let the deferred ranger selection run (see deferral test below)
    expect(fakeHandle.setDark).toHaveBeenCalledWith(false) // recolor the main chart (no reload)
    expect(fakeRanger.setDark).toHaveBeenCalledWith(false)
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(1000, 3000) // captured before the rebuild
  })

  it('defers the ranger selection until after the rebuild commits (avoids a zero-width collapse)', async () => {
    const c = makeController()
    await c.connect()
    fakeRanger.setSelection.mockClear()
    fakeHandle.uplot.scales.x = { min: 1000, max: 3000 }
    c.redrawTheme()
    // uPlot commits the rebuilt strip's scales on a microtask; setSelection must wait for it,
    // else valToPos returns NaN and the selection rectangle (and its grips) collapse to zero width.
    expect(fakeRanger.setSelection).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(1000, 3000)
  })

  it('falls back to the strip full extent when the main chart has no committed range', async () => {
    const c = makeController()
    await c.connect()
    fakeRanger.setSelection.mockClear()
    fakeHandle.uplot.scales.x = { min: null, max: null } // never zoomed / not yet committed
    fakeRanger.uplot = {
      data: [
        [5, 6, 7],
        [1, 2, 3]
      ]
    }
    c.redrawTheme()
    await Promise.resolve() // selection is deferred to a microtask
    // The rectangle must never vanish — fall back to the strip's own full extent.
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(5, 7)
  })
})

describe('ChartsController ranger gutters & average', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
    capturedRangerOpts = null
    fakeHandle.uplot.data = [[]]
  })

  it('measureGutters returns the over-vs-root plot insets', () => {
    const c = makeController()
    const u = {
      root: { getBoundingClientRect: () => ({ left: 0, right: 500 }) },
      over: { getBoundingClientRect: () => ({ left: 40, right: 480 }) }
    }
    expect(c.measureGutters(u)).toEqual({ left: 40, right: 20 })
  })

  it('the main-chart draw hook forwards measured gutters to the ranger', async () => {
    const c = makeController()
    await c.connect()
    fakeRanger.setGutters.mockClear()
    const u = {
      root: { getBoundingClientRect: () => ({ left: 0, right: 500 }) },
      over: { getBoundingClientRect: () => ({ left: 40, right: 480 }) }
    }
    const hooks = c.buildHooks()
    expect(typeof hooks.draw[0]).toBe('function')
    hooks.draw[0](u)
    expect(fakeRanger.setGutters).toHaveBeenCalledWith(40, 20)
  })
})

describe('ChartsController resize hook', () => {
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  it('re-fits the chart when the viewport WIDTH changes (desktop drag-resize / orientation)', async () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    await c.connect() // chart created at clientWidth 800 → seeds lastWidth = 800
    fakeHandle.resize.mockClear()
    fakeRanger.setWidth.mockClear()
    fakeRanger.setSelection.mockClear()
    // Give the main chart a known x-range so we can assert setSelection is re-applied.
    fakeHandle.uplot.scales.x = { min: 5, max: 9 }
    // The width actually changes (window drag / orientation flip), unlike a scroll.
    c.chartsViewTarget.clientWidth = 900
    c.rangerViewTarget.clientWidth = 900
    c.resizeChartToViewport()
    expect(fakeHandle.resize).toHaveBeenCalledWith(900, 628) // new width, 1000-200-140-32
    // ranger strip must be re-pixelled to the rangerViewTarget.clientWidth
    expect(fakeRanger.setWidth).toHaveBeenCalledWith(900)
    // selection rectangle is pixel-based → must be re-applied at the new width
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(5, 9)
  })

  it('ignores a height-only resize so a mobile toolbar collapse during scroll cannot rescale the chart', async () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    await c.connect() // chart created at clientWidth 800 → seeds lastWidth = 800
    fakeHandle.resize.mockClear()
    fakeRanger.setWidth.mockClear()
    fakeRanger.setSelection.mockClear()
    // Mobile scroll: the URL/toolbar collapses, innerHeight grows, width is untouched.
    Object.defineProperty(window, 'innerHeight', { value: 1100, configurable: true })
    c.resizeChartToViewport()
    expect(fakeHandle.resize).not.toHaveBeenCalled()
    expect(fakeRanger.setWidth).not.toHaveBeenCalled()
    expect(fakeRanger.setSelection).not.toHaveBeenCalled()
  })

  it('does nothing when there is no chart handle', () => {
    const c = makeController()
    c.handle = null
    expect(() => c.resizeChartToViewport()).not.toThrow()
  })

  it('connect registers a window resize listener and disconnect removes the same one', async () => {
    const c = makeController()
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    await c.connect()
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    c.disconnect()
    expect(removeSpy).toHaveBeenCalledWith('resize', c.onWindowResize)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
