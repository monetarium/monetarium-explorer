import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub Stimulus so the controller module loads in jsdom.
vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

// Mock the adapter + ranger (no real uPlot). createChart/createRanger return a fresh fake
// each call and push it onto a list so the tests can assert per-chart calls.
const makeFakeHandle = () => ({
  uplot: { data: [[]], scales: { x: {} }, over: null, root: null },
  setData: vi.fn(),
  setXRange: vi.fn(),
  setDark: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn()
})
const makeFakeRanger = () => ({
  uplot: { data: [[]] },
  setData: vi.fn(),
  setSelection: vi.fn(),
  setWidth: vi.fn(),
  setGutters: vi.fn(),
  setDark: vi.fn(),
  destroy: vi.fn()
})
let fakeHandles = []
let fakeRangers = []
vi.mock('../helpers/uplot_adapter', () => ({
  createChart: vi.fn(() => {
    const h = makeFakeHandle()
    fakeHandles.push(h)
    return Promise.resolve(h)
  }),
  resolveSeriesColor: vi.fn(() => 'rgb(1,2,3)')
}))
vi.mock('../helpers/uplot_ranger', () => ({
  createRanger: vi.fn(() => {
    const r = makeFakeRanger()
    fakeRangers.push(r)
    return Promise.resolve(r)
  })
}))

afterEach(() => {
  fakeHandles = []
  fakeRangers = []
})

const { default: AgendaController } = await import('./agenda_controller.js')

function targetStub() {
  return { clientWidth: 800, clientHeight: 300 }
}

// Build a controller wired with stub targets and the two chart specs, bypassing connect().
function makeController() {
  const ctrl = new AgendaController(document.createElement('div'))
  ctrl.cumulativeVoteChoicesTarget = targetStub()
  ctrl.voteChoicesByBlockTarget = targetStub()
  ctrl.cumulativeRangerTarget = targetStub()
  ctrl.blockRangerTarget = targetStub()
  ctrl.hasCumulativeRangerTarget = true
  ctrl.hasBlockRangerTarget = true
  ctrl.legendEntry = (s) => {
    const n = document.createElement('div')
    n.textContent = s
    return n
  }
  ctrl.legendMarker = () => ''
  ctrl.charts = ctrl.buildChartSpecs()
  return ctrl
}

const payloadByTime = {
  time: ['2024-06-01T22:00:00Z', '2024-06-02T22:00:00Z'],
  yes: [10, 30],
  abstain: [5, 5],
  no: [5, 15]
}
const payloadByHeight = { height: [4096, 4097], yes: [2, 0], abstain: [1, 0], no: [1, 0] }

describe('buildChartSpecs', () => {
  it('builds two specs: cumulative (time) and by-block (height)', () => {
    const ctrl = makeController()
    expect(ctrl.charts).toHaveLength(2)
    expect(ctrl.charts[0].key).toBe('cumulative')
    expect(ctrl.charts[0].xTime).toBe(true)
    expect(ctrl.charts[0].def.name).toBe('cumulative-vote-choices')
    expect(ctrl.charts[1].key).toBe('byBlock')
    expect(ctrl.charts[1].xTime).toBe(false)
    expect(ctrl.charts[1].def.name).toBe('vote-choices-by-block')
  })
})

describe('renderChart', () => {
  it('creates a handle, sets data from the def, and creates a ranger', async () => {
    const ctrl = makeController()
    const spec = ctrl.charts[0]
    spec.payload = payloadByTime
    await ctrl.renderChart(spec)
    expect(spec.handle).toBeTruthy()
    expect(spec.handle.setData).toHaveBeenCalledTimes(1)
    // setData fed the def's columns: [secs, yes, abstain, no]
    const cols = spec.handle.setData.mock.calls[0][0]
    expect(cols[1]).toEqual([10, 30])
    expect(spec.ranger).toBeTruthy()
    expect(spec.ranger.setData).toHaveBeenCalledTimes(1)
  })

  it('destroys an existing handle before recreating (no leak on re-render)', async () => {
    const ctrl = makeController()
    const spec = ctrl.charts[1]
    spec.payload = payloadByHeight
    await ctrl.renderChart(spec)
    const first = spec.handle
    await ctrl.renderChart(spec)
    expect(first.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('renderLegend tooltip', () => {
  it('renders the date x-label and per-series count+pct for the cumulative chart', async () => {
    const ctrl = makeController()
    const spec = ctrl.charts[0]
    spec.payload = payloadByTime
    await ctrl.renderChart(spec)
    spec.legendElement = document.createElement('div')
    const u = {
      cursor: { idx: 1 },
      data: [
        [1717279200, 1717365600],
        [10, 30],
        [5, 5],
        [5, 15]
      ],
      series: [{}, { show: true }, { show: true }, { show: true }],
      over: { clientWidth: 800, clientHeight: 300 }
    }
    ctrl.renderLegend(u, spec)
    const text = spec.legendElement.textContent
    expect(text).toContain('Date: 2024-06-02')
    expect(text).toContain('Yes: 30 (60.00%)')
    expect(text).toContain('No: 15 (30.00%)')
  })

  it('renders the block-height x-label for the by-block chart', async () => {
    const ctrl = makeController()
    const spec = ctrl.charts[1]
    spec.payload = payloadByHeight
    await ctrl.renderChart(spec)
    spec.legendElement = document.createElement('div')
    const u = {
      cursor: { idx: 0 },
      data: [
        [4096, 4097],
        [2, 0],
        [1, 0],
        [1, 0]
      ],
      series: [{}, { show: true }, { show: true }, { show: true }],
      over: { clientWidth: 800, clientHeight: 300 }
    }
    ctrl.renderLegend(u, spec)
    expect(spec.legendElement.textContent).toContain('Block Height: 4,096')
    expect(spec.legendElement.textContent).toContain('Yes: 2 (50.00%)')
  })

  it('hides the tooltip when the cursor leaves the plot (idx null)', () => {
    const ctrl = makeController()
    const spec = ctrl.charts[0]
    spec.legendElement = document.createElement('div')
    ctrl.renderLegend({ cursor: { idx: null }, data: [[]] }, spec)
    expect(spec.legendElement.classList.contains('d-hide')).toBe(true)
  })
})

describe('disconnect', () => {
  it('destroys every chart handle and ranger', async () => {
    const ctrl = makeController()
    for (const spec of ctrl.charts) {
      spec.payload = spec.xTime ? payloadByTime : payloadByHeight
      await ctrl.renderChart(spec)
    }
    const handles = ctrl.charts.map((c) => c.handle)
    const rangers = ctrl.charts.map((c) => c.ranger)
    // disconnect uses event-bus + window APIs; stub the parts it touches.
    ctrl.processNightMode = () => {}
    ctrl.onWindowResize = () => {}
    ctrl.disconnect()
    handles.forEach((h) => expect(h.destroy).toHaveBeenCalledTimes(1))
    rangers.forEach((r) => expect(r.destroy).toHaveBeenCalledTimes(1))
    expect(ctrl.charts.every((c) => c.handle === null && c.ranger === null)).toBe(true)
  })
})

describe('onRangerSelect', () => {
  it('drives the main handle x-range from a ranger drag', async () => {
    const ctrl = makeController()
    const spec = ctrl.charts[0]
    spec.payload = payloadByTime
    await ctrl.renderChart(spec)
    ctrl.onRangerSelect(spec, 100, 200)
    expect(spec.handle.setXRange).toHaveBeenCalledWith(100, 200)
  })
})

describe('onChartRangeChange', () => {
  it('mirrors a main-chart drag-zoom onto the ranger selection', async () => {
    const ctrl = makeController()
    const spec = ctrl.charts[0]
    spec.payload = payloadByTime
    await ctrl.renderChart(spec)
    ctrl.onChartRangeChange(spec, 100, 200)
    expect(spec.ranger.setSelection).toHaveBeenCalledWith(100, 200)
  })
})
