import { describe, expect, it, vi } from 'vitest'
import Zoom from '../helpers/zoom_helper'

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
  it('calls handle.setData with the definition columns for the current payload (with front+back pad)', async () => {
    // settings.bin = 'day' (set by makeRenderController) → Zoom.mapValue('day') = 86400000 ms
    // → binSize = 86400 s. Single point: duration=0 < binSize → pad = 43200 s.
    // Leading 0-balance point at 1717279200 - 43200 = 1717236000;
    // trailing sustain at 1717279200 + 43200 = 1717322400.
    const ctrl = makeRenderController('balance', 0, {
      time: ['2024-06-01T22:00:00Z'],
      balance: [12.5]
    })
    await ctrl.renderChart()
    expect(fakeHandle.setData).toHaveBeenCalledWith([
      [1717236000, 1717279200, 1717322400],
      [0, 12.5, 12.5]
    ])
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

  it('shows a 0 value on the non-stacked balance chart (zero-skip is stacked-only)', () => {
    // The leading 0-baseline point (balance was 0 before the first tx) must be visible in the
    // tooltip — unlike the stacked amount charts, a 0 balance is meaningful.
    const ctrl = makeRenderController('balance', 0, {
      time: ['2024-06-01T22:00:00Z'],
      balance: [0]
    })
    ctrl.currentDef = balanceDef(0)
    const entries = []
    ctrl.legendElement = {
      classList: { add() {}, remove() {} },
      replaceChildren: () => {},
      appendChild: (n) => entries.push(n.textContent)
    }
    ctrl.legendEntry = (txt) => ({ textContent: txt })
    ctrl.legendMarker = () => ''
    const u = {
      cursor: { idx: 0 },
      data: [[1717236000], [0]],
      series: [{}, { show: true }]
    }
    ctrl.positionTooltip = () => {}
    ctrl.renderLegend(u)
    expect(entries.some((e) => e.includes('Balance: 0 VAR'))).toBe(true)
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
    // setZoom args are ms; handle.setXRange receives seconds (÷1000).
    const ctrl = makeRenderController('balance', 0, {})
    ctrl.handle = fakeHandle
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    ctrl.chartLoaderTarget = { classList: { add() {}, remove() {} } }
    ctrl.setZoom(100, 200)
    expect(fakeHandle.setXRange).toHaveBeenCalledWith(0.1, 0.2)
  })
})

describe('address validateZoom (load-time preset restore)', () => {
  it('re-selects the zoom button matching the validated range on load (issue 1)', () => {
    // On reload the URL carries a zoom but connect() deselects every button; validateZoom
    // (run after the data lands) must re-highlight the matching preset. A full-extent range
    // maps to 'all'.
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 1000000] // ms
    c.settings = { zoom: null }
    // activeZoomKey reads zoomTarget; no button selected → getter returns null.
    c.zoomTarget = { getElementsByClassName: () => [] }
    c.setButtonVisibility = vi.fn()
    c.setZoom = vi.fn()
    const spy = vi.spyOn(c, 'setSelectedZoom').mockImplementation(() => {})

    c.validateZoom(1000) // binSize well under the 1e6 span → no shift/clamp

    expect(c.setZoom).toHaveBeenCalledWith(0, 1000000)
    // Full extent → mapKey 'all' → the All button gets re-selected.
    expect(spy).toHaveBeenCalledWith('all')
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
  it('onRangerSelect clears stale zoom-preset button via setSelectedZoom', () => {
    // onRangerSelect now uses `this` so it can be exercised directly on the instance.
    // Verifies that after a ranger drag, setSelectedZoom is called to reconcile the
    // preset-button highlight — the fix for the stale-preset bug.
    // Note: min/max args are seconds (ranger posToVal); xExtent is ms (post-units-fix).
    const c = makeRenderController('balance', 0, {})
    c.handle = fakeHandle
    // xExtent in ms (post-fix convention): 0 to 1 000 000 ms (≈16 min span).
    c.xExtent = [0, 1000000]
    c.settings = { zoom: null }
    c.query = { replace: vi.fn() }
    // Stub zoomButtons so setSelectedZoom can iterate without DOM.
    const btn = { name: 'all', classList: { add: vi.fn(), remove: vi.fn() } }
    c.zoomButtons = [btn]
    const spy = vi.spyOn(c, 'setSelectedZoom')
    // Ranger delivers seconds; handle.setXRange stays seconds; Zoom.encode gets ms.
    c.onRangerSelect(100, 500)
    expect(fakeHandle.setXRange).toHaveBeenCalledWith(100, 500)
    // setSelectedZoom must be called with the mapped zoom key — this is the fix.
    // Zoom.encode(100000, 500000) does not match any named preset against xExtent
    // [0, 1000000], so mapKey returns null; setSelectedZoom(null) clears btn-selected.
    const encodedZoom = Zoom.encode(100 * 1000, 500 * 1000)
    expect(spy).toHaveBeenCalledWith(Zoom.mapKey(encodedZoom, [0, 1000000]))
  })
  it('redrawTheme re-applies the ranger selection after theme toggle', async () => {
    // Regression: before the fix, setDark rebuilt the ranger strip without restoring the
    // selection rectangle — the rectangle collapsed to zero width on theme toggle.
    const ctrl = makeRenderController('balance', 0, {})
    // Set a known x-range on the main chart so redrawTheme can capture it.
    fakeHandle.uplot.scales.x = { min: 100, max: 200 }
    ctrl.handle = fakeHandle
    ctrl.ranger = fakeRanger
    fakeRanger.setDark.mockClear()
    fakeRanger.setSelection.mockClear()
    ctrl.redrawTheme()
    // setDark must fire synchronously.
    expect(fakeRanger.setDark).toHaveBeenCalled()
    // setSelection is deferred to a microtask — flush it.
    await Promise.resolve()
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(100, 200)
    // Restore shared mock to neutral state so other tests are unaffected.
    fakeHandle.uplot.scales.x = {}
  })
  it('resizeChart re-applies the ranger selection after width change', async () => {
    // Regression: before the fix, setWidth invalidated the pixel-based selection rectangle
    // and it was never restored — the rectangle vanished on every window resize.
    const ctrl = makeRenderController('balance', 0, {})
    fakeHandle.uplot.scales.x = { min: 100, max: 200 }
    ctrl.handle = fakeHandle
    ctrl.ranger = fakeRanger
    ctrl.chartTarget = { clientWidth: 900, clientHeight: 320 }
    ctrl.rangerViewTarget = { clientWidth: 900 }
    ctrl.hasRangerViewTarget = true
    fakeRanger.setWidth.mockClear()
    fakeRanger.setSelection.mockClear()
    ctrl.resizeChart()
    // setWidth must fire synchronously.
    expect(fakeRanger.setWidth).toHaveBeenCalled()
    // setSelection is deferred to a microtask — flush it.
    await Promise.resolve()
    expect(fakeRanger.setSelection).toHaveBeenCalledWith(100, 200)
    // Restore shared mock to neutral state.
    fakeHandle.uplot.scales.x = {}
  })
})

// Regression test: bug 3 (unit mismatch) — xExtent must be in ms so that chartDuration
// (xExtent[1]-xExtent[0]) is comparable to Zoom.mapValue keys (also ms). Before the fix,
// xExtent stored raw seconds from cols[0], so chartDuration was ~2592 for a 30-day chart
// while Zoom.mapValue('week')=6.048e8 ms — week/day buttons were wrongly hidden.
// After the fix, xExtent is ms, chartDuration ≈ 2.592e9 > 6.048e8 → buttons stay visible.
describe('address xExtent ms units (bug 3 regression)', () => {
  it('renderChart stores xExtent in ms so chartDuration exceeds zoomMap week value', async () => {
    // Build a 30-day payload spanning seconds timestamps (as the API returns).
    const startSec = 1700000000
    const endSec = startSec + 30 * 86400
    const ctrl = makeRenderController('balance', 0, {
      time: [new Date(startSec * 1000).toISOString(), new Date(endSec * 1000).toISOString()],
      balance: [1.0, 2.0]
    })
    ctrl.currentDef = balanceDef(0)
    ctrl.hasRangerViewTarget = false

    await ctrl.renderChart()

    // toColumns now brackets data with a leading 0-balance point and a trailing sustain.
    // binSize=86400 s, duration=30*86400 > binSize → pad=43200 s.
    // xExtent[0] is from the leading pad point: (startSec - 43200) * 1000.
    // xExtent[1] is from the trailing sustain point: (endSec + 43200) * 1000.
    expect(ctrl.xExtent[0]).toBeCloseTo((startSec - 43200) * 1000, -3)
    expect(ctrl.xExtent[1]).toBeCloseTo((endSec + 43200) * 1000, -3)

    // chartDuration (ms) ≈ (30*86400 + 2*43200)*1000 ≈ 2.679e9 > Zoom.mapValue('week')=6.048e8.
    // Before the fix: chartDuration ≈ 30*86400 ≈ 2.592e6 — less than 6.048e8 → bug.
    const chartDuration = ctrl.xExtent[1] - ctrl.xExtent[0]
    expect(chartDuration).toBeGreaterThan(Zoom.mapValue('week')) // 6.048e8 ms
    expect(chartDuration).toBeGreaterThan(Zoom.mapValue('day')) // 8.64e7 ms
    // Sanity: must not exceed 'year' (3.154e10 ms) for a 30-day span.
    expect(chartDuration).toBeLessThan(Zoom.mapValue('year'))
  })
})
