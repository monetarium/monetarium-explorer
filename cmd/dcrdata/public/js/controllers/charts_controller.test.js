import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    mapKey: vi.fn().mockReturnValue('zoom-option'),
    // 'all' maps to 0 (full extent → null span); any other preset gets a finite span.
    mapValue: vi.fn((key) => (key === 'all' ? 0 : 7 * 24 * 60 * 60 * 1000))
  }
}))

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

  it('double-click resets the ZOOM control to "all" and persists it', async () => {
    restoreSettings = { chart: 'ticket-pool-size', zoom: 'week' }
    const c = makeController()
    const allBtn = optBtn('all')
    const weekBtn = optBtn('week', true)
    c.zoomOptionTargets = [allBtn, weekBtn]

    await c.connect()
    expect(c.settings.zoom).toBe('week')
    mockReplace.mockClear()

    // Fire the dblclick the controller wired onto the chart container.
    c.chartsViewTarget.listeners.dblclick()

    expect(c.settings.zoom).toBe('all')
    expect(allBtn.classList.contains('active')).toBe(true)
    expect(weekBtn.classList.contains('active')).toBe(false)
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ zoom: 'all' }))
  })

  it('double-click is a no-op when "all" is already active', async () => {
    restoreSettings = { chart: 'ticket-pool-size', zoom: 'all' }
    const c = makeController()
    c.zoomOptionTargets = [optBtn('all', true), optBtn('week')]

    await c.connect()
    mockReplace.mockClear()

    c.chartsViewTarget.listeners.dblclick()

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('double-click resyncs the chart range to the full extent so a later rebuild keeps it', async () => {
    restoreSettings = { chart: 'ticket-pool-size', zoom: 'week' }
    const c = makeController()
    c.zoomOptionTargets = [optBtn('all'), optBtn('week', true)]

    await c.connect()
    // applyZoom reads the live x-axis off the handle; give it a real extent so the
    // reset can push it back into the adapter (otherwise applyZoom early-returns).
    fakeHandle.uplot.data = [
      [1000, 2000],
      [10, 20]
    ]
    fakeHandle.setXRange.mockClear()

    try {
      c.chartsViewTarget.listeners.dblclick()

      // The reset must hand the adapter the full data extent, replacing the stale
      // 'week' window it still remembers — otherwise the next MODE/SCALE rebuild
      // restores the old zoom even though the control now reads 'all'.
      expect(fakeHandle.setXRange).toHaveBeenCalledWith(1000, 2000)
    } finally {
      fakeHandle.uplot.data = [[]] // restore the shared fake for later tests
    }
  })

  it('disconnect removes the dblclick reset listener', async () => {
    const c = makeController()
    await c.connect()
    c.disconnect()
    expect(c.chartsViewTarget.removeEventListener).toHaveBeenCalledWith(
      'dblclick',
      expect.any(Function)
    )
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
