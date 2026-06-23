import { describe, expect, it, vi } from 'vitest'

// Stub the @hotwired/stimulus import so the controller module loads in jsdom.
vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

// ---------------------------------------------------------------------------
// Mocks for uPlot adapter + ranger (Task 9).
// Must be declared before the dynamic import so vi.mock hoisting picks them up.
// ---------------------------------------------------------------------------
const fakeHandle = {
  uplot: { data: [[]], scales: { x: {} }, setSeries: vi.fn(), setSelect: vi.fn(), over: null },
  setData: vi.fn(),
  setVisibility: vi.fn(),
  setXRange: vi.fn(),
  setDark: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn()
}
const fakeRanger = {
  uplot: { data: [[]] },
  setData: vi.fn(),
  setSelection: vi.fn(),
  setWidth: vi.fn(),
  setGutters: vi.fn(),
  setDark: vi.fn(),
  destroy: vi.fn()
}
vi.mock('../helpers/uplot_adapter', () => ({
  createChart: vi.fn().mockResolvedValue(fakeHandle),
  resolveSeriesColor: vi.fn(() => 'rgb(1,2,3)')
}))
vi.mock('../helpers/uplot_ranger', () => ({
  createRanger: vi.fn().mockResolvedValue(fakeRanger)
}))

const { default: AddressController, flowVisibility } = await import('./address_controller.js')
const { amountflowDef, balanceDef } = await import('../charts/definitions/address.js')

function makeBoxes(state) {
  // state: { received, sent, net } booleans
  const boxes = [
    { value: '2', checked: !!state.sent },
    { value: '1', checked: !!state.received },
    { value: '4', checked: !!state.net }
  ]
  boxes.forEach = Array.prototype.forEach.bind(boxes)
  return boxes
}

// Build a minimal controller suitable for render/zoom/flow tests.
// chart: 'balance' | 'amountflow' | 'types'
// coin: integer (0 = VAR)
// payload: the raw API response object to store in retrievedData
function makeRenderController(chart, coin, payload) {
  const ctrl = new AddressController(document.createElement('div'))
  ctrl.settings = { chart: chart, bin: 'day', coin: String(coin), zoom: null, flow: null }
  ctrl.state = {}
  ctrl.query = { replace: vi.fn() }
  ctrl.retrievedData = {}
  ctrl.effectiveCoin = () => coin
  ctrl.payload = payload
  // Store payload under the expected cache key.
  const key = chart === 'balance' ? 'amountflow' : chart
  ctrl.retrievedData[`${key}-day-${coin}`] = payload
  ctrl.requestedChart = `${chart}-day-${coin}`
  ctrl.currentDef = ctrl.defFor ? ctrl.defFor(chart, coin) : null
  // Stub required DOM targets
  ctrl.chartTarget = { clientWidth: 800, clientHeight: 320 }
  ctrl.chartTitleTarget = { textContent: '' }
  ctrl.hasChartTitleTarget = true
  ctrl.chartLoaderTarget = { classList: { add() {}, remove() {} } }
  ctrl.rangerViewTarget = { clientWidth: 800 }
  ctrl.hasRangerViewTarget = false
  ctrl.labelsTarget = document.createElement('div')
  ctrl.flowTarget = { classList: { add() {}, remove() {} } }
  // Stub legend helpers (filled in 9-b but needed for rendering path)
  ctrl.legendElement = null
  ctrl.legendEntry = (s) => {
    const n = document.createElement('div')
    n.textContent = s
    return n
  }
  ctrl.legendMarker = () => ''
  // Reset mocks on each controller creation
  fakeHandle.setData.mockClear()
  fakeHandle.setVisibility.mockClear()
  fakeHandle.setXRange.mockClear()
  fakeHandle.setDark.mockClear()
  fakeHandle.resize.mockClear()
  fakeHandle.destroy.mockClear()
  fakeRanger.setData.mockClear()
  fakeRanger.setSelection.mockClear()
  fakeRanger.setDark.mockClear()
  return ctrl
}

describe('flowVisibility', () => {
  it('maps Received only (bit 1)', () => {
    expect(flowVisibility(1)).toEqual({
      Received: true,
      Spent: false,
      'Net Received': false,
      'Net Spent': false
    })
  })
  it('maps Sent only (bit 2)', () => {
    expect(flowVisibility(2)).toEqual({
      Received: false,
      Spent: true,
      'Net Received': false,
      'Net Spent': false
    })
  })
  it('maps Net only (bit 4) onto both net series', () => {
    expect(flowVisibility(4)).toEqual({
      Received: false,
      Spent: false,
      'Net Received': true,
      'Net Spent': true
    })
  })
  it('maps Received + Net (bit 5)', () => {
    expect(flowVisibility(5)).toEqual({
      Received: true,
      Spent: false,
      'Net Received': true,
      'Net Spent': true
    })
  })
  it('maps all three checked (bit 7)', () => {
    expect(flowVisibility(7)).toEqual({
      Received: true,
      Spent: true,
      'Net Received': true,
      'Net Spent': true
    })
  })
  it('returns booleans only', () => {
    for (const v of Object.values(flowVisibility(4))) {
      expect(typeof v).toBe('boolean')
    }
  })
})

describe('address renderChart', () => {
  it('calls handle.setData with the definition columns for the current payload', async () => {
    const ctrl = makeRenderController('balance', 0, {
      time: ['2024-06-01T22:00:00Z'],
      balance: [12.5]
    })
    await ctrl.renderChart()
    expect(fakeHandle.setData).toHaveBeenCalledWith([[1717279200], [12.5]])
  })
})

describe('address renderLegend', () => {
  it('reads raw payload values (not cumulative u.data) for stacked amountflow VAR', () => {
    // payload: received=10, sent=0, net=10
    // u.data reflects cumulative stacking: received=10, +sent0=10, +netReceived10=20, +netSpent0=20
    // The key assertion: Net Received must show 10 (raw payload), NOT 20 (cumulative u.data[3][0]).
    const ctrl = makeRenderController('amountflow', 0, {
      time: ['2024-06-01T22:00:00Z'],
      received: [10],
      sent: [0],
      net: [10]
    })
    ctrl.currentDef = amountflowDef(0)
    const entries = []
    ctrl.legendElement = {
      classList: { add() {}, remove() {} },
      replaceChildren: () => {},
      appendChild: (n) => entries.push(n.textContent)
    }
    ctrl.legendEntry = (txt) => ({ textContent: txt })
    ctrl.legendMarker = () => ''
    // Cumulative u.data as the adapter would produce after stacking all visible series:
    // [time, Received=10, Received+Spent=10, Received+Spent+NetReceived=20, ...+NetSpent=20]
    const u = {
      cursor: { idx: 0 },
      data: [[1717279200], [10], [10], [20], [20]],
      series: [{}, { show: true }, { show: true }, { show: true }, { show: true }]
    }
    ctrl.positionTooltip = () => {}
    ctrl.renderLegend(u)
    // Received: raw payload value 10 must be shown
    expect(entries.some((e) => e.includes('Received: 10 VAR'))).toBe(true)
    // Net Received: raw payload net[0]=10, NOT cumulative u.data[3][0]=20
    expect(entries.some((e) => e.includes('Net Received: 10 VAR'))).toBe(true)
    expect(entries.some((e) => e.includes('Net Received: 20 VAR'))).toBe(false)
    // Spent=0 is zero-skipped
    expect(entries.some((e) => e.includes('Spent: 0 VAR'))).toBe(false)
    // Net Spent=0 is zero-skipped
    expect(entries.some((e) => e.includes('Net Spent'))).toBe(false)
  })
})

describe('address updateFlow', () => {
  it('applies the label-keyed visibility map to the handle', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ received: true, sent: false, net: true })
    ctrl.handle = fakeHandle
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    ctrl.updateFlow()
    expect(fakeHandle.setVisibility).toHaveBeenCalledWith({
      Received: true,
      Spent: false,
      'Net Received': true,
      'Net Spent': true
    })
    expect(ctrl.settings.flow).toBe(5)
  })
})

describe('address setZoom', () => {
  it('drives the handle x-range and persists zoom', () => {
    const ctrl = makeRenderController('balance', 0, {})
    ctrl.handle = fakeHandle
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    ctrl.chartLoaderTarget = { classList: { add() {}, remove() {} } }
    ctrl.setZoom(100, 200)
    expect(fakeHandle.setXRange).toHaveBeenCalledWith(100, 200)
  })
})

describe('address ranger + theme', () => {
  it('creates a ranger seeded with the x + primary series columns', async () => {
    const { createRanger } = await import('../helpers/uplot_ranger')
    const ctrl = makeRenderController('balance', 0, {})
    ctrl.currentDef = balanceDef(0)
    ctrl.hasRangerViewTarget = true
    ctrl.rangerViewTarget = { clientWidth: 800 }
    await ctrl.recreateRanger(balanceDef(0), [
      [1, 2],
      [10, 20]
    ])
    expect(createRanger).toHaveBeenCalled()
    expect(fakeRanger.setData).toHaveBeenCalledWith([
      [1, 2],
      [10, 20]
    ])
  })
  it('redrawTheme pushes dark state to handle and ranger', () => {
    const ctrl = makeRenderController('balance', 0, {})
    ctrl.handle = fakeHandle
    ctrl.ranger = fakeRanger
    ctrl.redrawTheme()
    expect(fakeHandle.setDark).toHaveBeenCalled()
    expect(fakeRanger.setDark).toHaveBeenCalled()
  })
})
