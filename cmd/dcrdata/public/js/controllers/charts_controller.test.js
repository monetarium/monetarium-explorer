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

// One fake ChartPanel per createChartPanel call. The controller's scaffolding (chart, tooltip,
// touch-scrub, ranger, theme, resize) now lives in ChartPanel, covered by chart_panel.test.js;
// here we only verify the page-specific wiring and logic. capturedPanelOpts exposes the live
// option callbacks (xTime/scaleType/mode/measureSize/formatX/onRangeChange) for assertions.
let capturedPanelOpts = null
const fakePanelHandle = {
  uplot: {
    data: [
      [1, 2],
      [10, 20]
    ],
    scales: { x: {} }
  },
  setScaleType: vi.fn(),
  setMode: vi.fn(),
  setVisibility: vi.fn()
}
const fakePanel = {
  handle: fakePanelHandle,
  render: vi.fn().mockResolvedValue(),
  setXRange: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn()
}
vi.mock('../helpers/chart_panel', () => ({
  createChartPanel: vi.fn((el, opts) => {
    capturedPanelOpts = opts
    return fakePanel
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
  c.rawDataURLTarget = { textContent: '' }
  c.chartsViewTarget = {
    classList: { add: vi.fn(), remove: vi.fn() },
    clientWidth: 800,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 0 })
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

    c.chartSelectTarget.value = 'ticket-pool-size'

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

    await c.setBin({ target: binOption })

    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ bin: 'block' }))
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

    await c.setAxis({ target: axisOption })

    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ axis: 'height' }))
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

describe('ChartsController panel wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
  })

  it('constructs one panel whose xTime/scaleType/mode/measureSize/formatX read live settings', async () => {
    const c = makeController()
    await c.connect()
    expect(typeof capturedPanelOpts.xTime).toBe('function')
    expect(typeof capturedPanelOpts.scaleType).toBe('function')
    expect(typeof capturedPanelOpts.mode).toBe('function')
    expect(typeof capturedPanelOpts.measureSize).toBe('function')
    expect(typeof capturedPanelOpts.formatX).toBe('function')
    expect(typeof capturedPanelOpts.onRangeChange).toBe('function')

    c.settings.axis = 'time'
    expect(capturedPanelOpts.xTime()).toBe(true)
    c.settings.axis = 'height'
    expect(capturedPanelOpts.xTime()).toBe(false)
    c.settings.scale = 'log'
    expect(capturedPanelOpts.scaleType()).toBe('log')
    c.settings.scale = 'linear'
    expect(capturedPanelOpts.scaleType()).toBe('linear')
    c.settings.mode = 'stepped'
    expect(capturedPanelOpts.mode()).toBe('stepped')
    c.settings.mode = null
    expect(capturedPanelOpts.mode()).toBe('line')
  })

  it('formatX renders a Date label on the time axis and a Block Height label otherwise', async () => {
    const c = makeController()
    await c.connect()
    c.settings.axis = 'height'
    expect(capturedPanelOpts.formatX(1234)).toBe('Block Height: 1234')
    c.settings.axis = 'time'
    expect(capturedPanelOpts.formatX(1000)).toContain('Date:')
  })

  it('renders via the panel with the page settings (tps/windowSize)', async () => {
    const c = makeController()
    await c.connect()
    expect(fakePanel.render).toHaveBeenCalled()
    const [, , settings] = fakePanel.render.mock.calls.at(-1)
    expect(settings).toHaveProperty('tps')
    expect(settings).toHaveProperty('windowSize')
  })

  it('disconnect destroys the panel', async () => {
    const c = makeController()
    await c.connect()
    c.disconnect()
    expect(fakePanel.destroy).toHaveBeenCalled()
  })
})

describe('ChartsController def memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
  })

  it('returns the same reference for a stable signature, a new one when structure changes', async () => {
    const c = makeController()
    await c.connect()
    c.payload = {}
    const base = {
      name: 'demo',
      axes: [{ label: 'A' }],
      series: [{ label: 'S', kind: 'line' }],
      toColumns: () => [[1], [2]],
      formatValue: () => ''
    }
    const a = c.memoizedDef(base)
    const b = c.memoizedDef({ ...base }) // same name/xTime/seriesCount/label -> same ref
    expect(b).toBe(a)
    const grown = { ...base, series: [...base.series, { label: 'T', kind: 'line' }] }
    const cc = c.memoizedDef(grown) // series count changed -> new ref
    expect(cc).not.toBe(a)
  })

  it('a different axis label yields a new reference (dynamic axis-label rebuild)', async () => {
    const c = makeController()
    await c.connect()
    c.payload = {}
    const base = {
      name: 'demo',
      axes: [{ label: 'A' }],
      series: [{ label: 'S', kind: 'line' }],
      toColumns: () => [[1], [2]],
      formatValue: () => ''
    }
    const a = c.memoizedDef(base)
    const relabeled = { ...base, axes: [{ label: 'B' }] }
    expect(c.memoizedDef(relabeled)).not.toBe(a)
  })
})

describe('ChartsController zoom target', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
  })

  it('a preset key yields a trailing window ending at dataMax', async () => {
    const c = makeController()
    await c.connect()
    c.settings.axis = 'time'
    c.settings.zoom = 'week' // 6.048e8 ms -> 604800 plot-seconds
    expect(c.computeZoomTarget([1000, 1000000])).toEqual({ min: 1000000 - 604800, max: 1000000 })
  })

  it('an encoded range restores clamped to the data', async () => {
    const c = makeController()
    await c.connect()
    c.settings.axis = 'time'
    c.settings.zoom = `${(500000000).toString(36)}-${(600000000).toString(36)}`
    expect(c.computeZoomTarget([1000, 1000000])).toEqual({ min: 500000, max: 600000 })
  })

  it('returns the full extent when no zoom is set', async () => {
    const c = makeController()
    await c.connect()
    c.settings.zoom = null
    expect(c.computeZoomTarget([1000, 1000000])).toEqual({ min: 1000, max: 1000000 })
  })

  it('returns null when there is no data', async () => {
    const c = makeController()
    await c.connect()
    expect(c.computeZoomTarget([])).toBeNull()
    expect(c.computeZoomTarget(undefined)).toBeNull()
  })
})

describe('ChartsController drag persistence (via panel onRangeChange)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
    fakePanelHandle.uplot.data = [
      [1, 2],
      [10, 20]
    ]
  })

  it('maps a full-extent chart drag (double-click reset) back to the "all" preset', async () => {
    restoreSettings = { chart: 'ticket-pool-size', zoom: 'week' }
    const c = makeController()
    const allBtn = optBtn('all')
    const weekBtn = optBtn('week', true)
    c.zoomOptionTargets = [allBtn, weekBtn]
    await c.connect()
    c.payload = {}
    fakePanelHandle.uplot.data = [
      [1000, 1000000],
      [10, 20]
    ]
    mockReplace.mockClear()

    capturedPanelOpts.onRangeChange(1000, 1000000, 'chart')

    expect(c.settings.zoom).toBe('all')
    expect(allBtn.classList.contains('active')).toBe(true)
    expect(weekBtn.classList.contains('active')).toBe(false)
  })

  it('a chart drag snaps a trailing week-wide window back to the "week" preset', async () => {
    const c = makeController()
    const allBtn = optBtn('all', true)
    const weekBtn = optBtn('week')
    c.zoomOptionTargets = [allBtn, weekBtn]
    await c.connect()
    c.payload = {}
    const dataMax = 1000000
    fakePanelHandle.uplot.data = [
      [1000, dataMax],
      [10, 20]
    ]
    mockReplace.mockClear()

    capturedPanelOpts.onRangeChange(dataMax - 604800, dataMax, 'chart')

    expect(c.settings.zoom).toBe('week')
    expect(weekBtn.classList.contains('active')).toBe(true)
  })

  it('a ranger-strip drag persists a CUSTOM range and clears presets, even at a preset-width span', async () => {
    const c = makeController()
    const allBtn = optBtn('all', true)
    const weekBtn = optBtn('week')
    c.zoomOptionTargets = [allBtn, weekBtn]
    await c.connect()
    c.payload = {}
    const dataMax = 1000000
    fakePanelHandle.uplot.data = [
      [1000, dataMax],
      [10, 20]
    ]
    mockReplace.mockClear()

    // A trailing week-wide window — a CHART drag would snap this to "week", but the strip
    // path (source 'ranger') must NOT snap.
    capturedPanelOpts.onRangeChange(dataMax - 604800, dataMax, 'ranger')

    expect(weekBtn.classList.contains('active')).toBe(false)
    expect(allBtn.classList.contains('active')).toBe(false)
    const expected = `${((dataMax - 604800) * 1000).toString(36)}-${(dataMax * 1000).toString(36)}`
    expect(c.settings.zoom).toBe(expected)
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ zoom: expected }))
  })

  it('clicking a preset drives the panel x-range', async () => {
    const c = makeController()
    await c.connect()
    c.payload = {}
    fakePanelHandle.uplot.data = [
      [1000, 1000000],
      [10, 20]
    ]
    const dayBtn = optBtn('day')
    c.zoomOptionTargets = [dayBtn]
    fakePanel.setXRange.mockClear()

    c.setZoom({ target: dayBtn })

    expect(fakePanel.setXRange).toHaveBeenCalled()
  })
})

describe('ChartsController control handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
  })

  it('setScale toggles the panel handle scale type and persists scale', async () => {
    const c = makeController()
    await c.connect()
    const scaleOpt = {
      classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
      dataset: { option: 'log' }
    }
    c.scaleTypeTargets = [scaleOpt]
    c.setScale({ target: scaleOpt })
    expect(fakePanelHandle.setScaleType).toHaveBeenCalledWith('log')
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ scale: 'log' }))
  })

  it('setMode maps the line option to a line on the panel handle and persists mode', async () => {
    const c = makeController()
    await c.connect()
    const modeOpt = {
      classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
      dataset: { option: 'line' }
    }
    c.modeOptionTargets = [modeOpt]
    c.setMode({ target: modeOpt })
    expect(fakePanelHandle.setMode).toHaveBeenCalledWith('line')
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ mode: 'line' }))
  })
})

describe('ChartsController hashrate chart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
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

describe('ChartsController viewport fit', () => {
  // computeChartHeight reads documentElement.clientHeight (the layout viewport), not innerHeight.
  const setViewportHeight = (h) =>
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: h,
      configurable: true
    })

  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    setViewportHeight(0)
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('computeChartHeight fills the viewport below the chart top, reserving below-chart chrome', () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    setViewportHeight(1000)
    expect(c.computeChartHeight()).toBe(664) // 1000 - 200 - 104 - 32
  })

  it('computeChartHeight is scroll-independent (uses the document-absolute chart top)', () => {
    const c = makeController()
    setViewportHeight(1000)
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 50 })
    Object.defineProperty(window, 'scrollY', { value: 150, configurable: true })
    expect(c.computeChartHeight()).toBe(664) // 1000 - (50 + 150) - 104 - 32
  })

  it('computeChartHeight ignores a transient bogus innerHeight during an orientation flip', () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    setViewportHeight(1000)
    Object.defineProperty(window, 'innerHeight', { value: 1952, configurable: true })
    expect(c.computeChartHeight()).toBe(664) // documentElement-based, NOT 1952
  })

  it('computeChartHeight clamps to the 320px readability floor on short viewports', () => {
    const c = makeController()
    c.chartsViewTarget.getBoundingClientRect = () => ({ top: 200 })
    setViewportHeight(500)
    expect(c.computeChartHeight()).toBe(320) // 500 - 200 - 104 - 32 = 164 -> floored
  })
})

describe('ChartsController selection concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreSettings = null
  })

  it('a fetch resolving after a newer selection does not clobber the payload/selection', async () => {
    const { requestJSON } = await import('../helpers/http')
    const c = makeController()
    await c.connect()

    let resolveA, resolveB
    requestJSON
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveB = resolve)))

    c.chartSelectTarget.value = 'chart-A'
    const pA = c.selectChart() // suspends on fetch A
    c.chartSelectTarget.value = 'chart-B'
    const pB = c.selectChart() // suspends on fetch B (now the current selection)

    resolveB({ axis: 'time', bin: 'block', t: [1000, 2000] })
    await pB
    expect(c.selectedChartName).toBe('chart-B')

    // A resolves last but is stale: its continuation must bail before touching state.
    resolveA({ axis: 'time', bin: 'block', t: [9000, 9999] })
    await pA
    expect(c.selectedChartName).toBe('chart-B')
  })
})
