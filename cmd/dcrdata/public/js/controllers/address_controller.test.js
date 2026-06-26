import { afterEach, describe, expect, it, vi } from 'vitest'
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
// Fake ChartPanel: the controller now owns one panel instead of a raw handle + ranger.
// The chart/tooltip/ranger/theme/resize behavior is tested in chart_panel.test.js; here we
// only assert the controller drives the panel correctly. Declared before the dynamic import
// so vi.mock hoisting picks it up.
// ---------------------------------------------------------------------------
const fakePanelHandle = {
  uplot: {
    data: [
      [1, 2],
      [10, 20]
    ],
    scales: { x: {} }
  },
  setVisibility: vi.fn()
}
const fakePanel = {
  handle: fakePanelHandle,
  ranger: {},
  render: vi.fn().mockResolvedValue(undefined),
  setXRange: vi.fn(),
  resize: vi.fn(),
  destroy: vi.fn()
}
vi.mock('../helpers/chart_panel', () => ({
  createChartPanel: vi.fn(() => fakePanel)
}))

// Reset shared singleton mock state that individual tests mutate, so a thrown assertion
// mid-test can't leak it into later tests (order-dependent failures).
afterEach(() => {
  fakePanelHandle.uplot.scales.x = {}
  fakePanelHandle.uplot.data = [
    [1, 2],
    [10, 20]
  ]
})

const {
  default: AddressController,
  flowVisibility,
  rangerColumn
} = await import('./address_controller.js')

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
  ctrl.flowTarget = { classList: { add() {}, remove() {} } }
  // The controller drives a single ChartPanel.
  ctrl.panel = fakePanel
  fakePanel.render.mockClear()
  fakePanel.setXRange.mockClear()
  fakePanel.resize.mockClear()
  fakePanel.destroy.mockClear()
  fakePanelHandle.setVisibility.mockClear()
  return ctrl
}

// Fake control button: tracks its classes in a Set so the test can assert d-hide /
// btn-selected after setButtonVisibility runs. `fixed` mirrors the data-fixed attribute.
function makeBtn(name, opts = {}) {
  const classes = new Set()
  if (opts.selected) classes.add('btn-selected')
  return {
    name: name,
    dataset: opts.fixed ? { fixed: '1' } : {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    has: (c) => classes.has(c)
  }
}

describe('address setButtonVisibility (active button survives a short range)', () => {
  it('keeps the selected Group By button visible when the range is below its bin', () => {
    // 14 days of history (ms). Month threshold = Zoom.mapValue('month') = 2.628e9 ms, so a
    // 14-day chartDuration (1.2096e9) is below it — without the guard the default/active
    // "Month" Group By button would be hidden AND deselected (the SKA2 < 1-month bug).
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 14 * 86400 * 1000]
    const monthBin = makeBtn('month', { selected: true })
    c.binputs = [
      makeBtn('year'),
      monthBin,
      makeBtn('week'),
      makeBtn('day', { fixed: true }),
      makeBtn('all', { fixed: true })
    ]
    // Zoom set: "all" is the (fixed) active preset; Month is NOT selected here.
    const zoomMonth = makeBtn('month')
    c.zoomButtons = [makeBtn('all', { fixed: true, selected: true }), makeBtn('year'), zoomMonth]

    c.setButtonVisibility()

    // The active Group By "Month" button stays visible and selected.
    expect(monthBin.has('d-hide')).toBe(false)
    expect(monthBin.has('btn-selected')).toBe(true)
    // The unselected Zoom "Month" button still hides — zooming to a month with < 1 month
    // of data is meaningless, so the duration gate correctly removes it.
    expect(zoomMonth.has('d-hide')).toBe(true)
  })

  it('still hides a coarse bin button that is neither fixed nor selected', () => {
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 14 * 86400 * 1000] // 14 days
    const yearBin = makeBtn('year') // 14 days < 1 year, not selected → hide
    const weekBin = makeBtn('week') // 14 days > 1 week → stays visible
    c.binputs = [yearBin, weekBin]
    c.zoomButtons = []
    c.setButtonVisibility()
    expect(yearBin.has('d-hide')).toBe(true)
    expect(weekBin.has('d-hide')).toBe(false)
  })
})

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
  it('renders via the panel with the definition for the current payload and settings', async () => {
    const ctrl = makeRenderController('balance', 0, {
      time: ['2024-06-01T22:00:00Z'],
      balance: [12.5]
    })
    await ctrl.renderChart()
    expect(fakePanel.render).toHaveBeenCalledTimes(1)
    const [def, payload, settings] = fakePanel.render.mock.calls[0]
    expect(def.name).toBe('balance')
    expect(payload).toBe(ctrl.payload)
    expect(settings.binSize).toBe(86400) // Zoom.mapValue('day')=86400000 ms / 1000
  })

  it('applies amountflow visibility via the escape hatch after render (no build-time double-stack)', async () => {
    const ctrl = makeRenderController('amountflow', 0, {
      time: ['2024-06-01T22:00:00Z'],
      received: [10],
      sent: [3],
      net: [7]
    })
    ctrl.flowBoxes = makeBoxes({ received: true, sent: true, net: false }) // bitmap 3
    await ctrl.renderChart()
    expect(fakePanelHandle.setVisibility).toHaveBeenCalledWith({
      Received: true,
      Spent: true,
      'Net Received': false,
      'Net Spent': false
    })
  })

  it('passes a saved zoom to the panel as an explicit target range (seconds)', async () => {
    const ctrl = makeRenderController('balance', 0, {
      time: ['2024-06-01T22:00:00Z'],
      balance: [12.5]
    })
    // Zoom.encode takes ms; renderChart converts to seconds for the panel target.
    ctrl.settings.zoom = Zoom.encode(1717236000000, 1717322400000)
    await ctrl.renderChart()
    const opts = fakePanel.render.mock.calls[0][3]
    expect(opts.range.min).toBeCloseTo(1717236000, 0)
    expect(opts.range.max).toBeCloseTo(1717322400, 0)
  })
})

describe('address updateFlow', () => {
  it('applies the label-keyed visibility map to the panel handle', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ received: true, sent: true, net: false })
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    ctrl.updateFlow()
    expect(fakePanelHandle.setVisibility).toHaveBeenCalledWith({
      Received: true,
      Spent: true,
      'Net Received': false,
      'Net Spent': false
    })
    expect(ctrl.settings.flow).toBe(3)
  })

  it('clamps a Net + Sent/Received bitmap to Net-only on the programmatic path (finding #1)', () => {
    // A saved/crafted ?flow=7 leaves Net checked alongside Sent + Received; updateFlow() with no
    // event must not stack Net on top of them (double-count). Net wins.
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ received: true, sent: true, net: true })
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    ctrl.updateFlow() // programmatic — no event
    expect(ctrl.settings.flow).toBe(4)
    expect(fakePanelHandle.setVisibility).toHaveBeenCalledWith({
      Received: false,
      Spent: false,
      'Net Received': true,
      'Net Spent': true
    })
    // The conflicting boxes are cleared so the control reflects the clamped view.
    expect(ctrl.flowBoxes.find((b) => b.value === '1').checked).toBe(false) // Received
    expect(ctrl.flowBoxes.find((b) => b.value === '2').checked).toBe(false) // Sent
    expect(ctrl.flowBoxes.find((b) => b.value === '4').checked).toBe(true) // Net
  })
})

describe('address flow Net exclusivity (finding #2)', () => {
  it('checking Net clears Sent and Received', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ sent: true, received: true, net: true })
    const net = ctrl.flowBoxes.find((b) => b.value === '4')
    ctrl.enforceFlowExclusivity(net)
    expect(ctrl.flowBoxes.find((b) => b.value === '2').checked).toBe(false) // Sent
    expect(ctrl.flowBoxes.find((b) => b.value === '1').checked).toBe(false) // Received
    expect(net.checked).toBe(true)
  })
  it('checking Received clears Net', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ sent: false, received: true, net: true })
    const received = ctrl.flowBoxes.find((b) => b.value === '1')
    ctrl.enforceFlowExclusivity(received)
    expect(ctrl.flowBoxes.find((b) => b.value === '4').checked).toBe(false) // Net
    expect(received.checked).toBe(true)
  })
  it('checking Sent clears Net', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ sent: true, received: false, net: true })
    const sent = ctrl.flowBoxes.find((b) => b.value === '2')
    ctrl.enforceFlowExclusivity(sent)
    expect(ctrl.flowBoxes.find((b) => b.value === '4').checked).toBe(false) // Net
    expect(sent.checked).toBe(true)
  })
  it('unchecking a box clears nothing', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ sent: true, received: true, net: false })
    const sent = ctrl.flowBoxes.find((b) => b.value === '2')
    sent.checked = false
    ctrl.enforceFlowExclusivity(sent)
    expect(ctrl.flowBoxes.find((b) => b.value === '1').checked).toBe(true) // Received untouched
  })
  it('updateFlow enforces exclusivity on a Net toggle and shows only Net', () => {
    const ctrl = makeRenderController('amountflow', 0, {})
    ctrl.flowBoxes = makeBoxes({ sent: true, received: true, net: true })
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    const net = ctrl.flowBoxes.find((b) => b.value === '4')
    ctrl.updateFlow({ target: net })
    expect(ctrl.settings.flow).toBe(4)
    expect(fakePanelHandle.setVisibility).toHaveBeenCalledWith({
      Received: false,
      Spent: false,
      'Net Received': true,
      'Net Spent': true
    })
  })
})

describe('address setZoom', () => {
  it('drives the panel x-range (seconds) and persists zoom', () => {
    // setZoom args are ms; panel.setXRange receives seconds (÷1000).
    const ctrl = makeRenderController('balance', 0, {})
    ctrl.settings = {}
    ctrl.query = { replace: vi.fn() }
    ctrl.chartLoaderTarget = { classList: { add() {}, remove() {} } }
    ctrl.setZoom(100, 200)
    expect(fakePanel.setXRange).toHaveBeenCalledWith(0.1, 0.2)
  })
})

describe('rangerColumn (ranger line covers the latest histogram bar)', () => {
  it('sustains the last real value across a trailing null pad', () => {
    expect(rangerColumn([10, 20, null])).toEqual([10, 20, 20])
  })
  it('leaves a column without a trailing null untouched (e.g. balance sustain pad)', () => {
    expect(rangerColumn([10, 20, 30])).toEqual([10, 20, 30])
  })
  it('skips an interior null to find the value to sustain', () => {
    expect(rangerColumn([10, null, null])).toEqual([10, null, 10])
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

  it('falls back to the full extent for a malformed ?zoom= param (finding #2)', () => {
    // A dashless ?zoom=foo that isn't a preset key makes Zoom.validate return the bare string,
    // whose .start/.end are undefined. Without the guard this drove setZoom(undefined) ->
    // setXRange(NaN), blanking the chart and persisting a 'NaN-NaN' range.
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 1000000] // ms
    c.settings = { zoom: 'foo' }
    c.zoomTarget = { getElementsByClassName: () => [] } // activeZoomKey → null
    c.setButtonVisibility = vi.fn()
    c.setZoom = vi.fn()
    const spy = vi.spyOn(c, 'setSelectedZoom').mockImplementation(() => {})

    c.validateZoom(1000)

    // No NaN reaches setZoom: it gets the full extent, and the 'all' preset is re-selected.
    expect(c.setZoom).toHaveBeenCalledWith(0, 1000000)
    expect(spy).toHaveBeenCalledWith('all')
  })
})

// Regression test: bug 3 (unit mismatch) — xExtent must be in ms so that chartDuration
// (xExtent[1]-xExtent[0]) is comparable to Zoom.mapValue keys (also ms). Before the fix,
// xExtent stored raw seconds from cols[0], so chartDuration was ~2592 for a 30-day chart
// while Zoom.mapValue('week')=6.048e8 ms — week/day buttons were wrongly hidden.
// After the fix, xExtent is ms, chartDuration ≈ 2.592e9 > 6.048e8 → buttons stay visible.
describe('address xExtent ms units (bug 3 regression)', () => {
  it('renderChart stores xExtent in ms from the plotted x column', async () => {
    const startSec = 1700000000
    const endSec = startSec + 30 * 86400
    const ctrl = makeRenderController('balance', 0, {
      time: [new Date(startSec * 1000).toISOString(), new Date(endSec * 1000).toISOString()],
      balance: [1.0, 2.0]
    })
    // The panel plots these seconds; the controller derives xExtent (ms) from the handle's
    // x column. Set the handle's plotted x to the panel's seconds output.
    fakePanelHandle.uplot.data = [
      [startSec, endSec],
      [1.0, 2.0]
    ]
    await ctrl.renderChart()
    expect(ctrl.xExtent[0]).toBe(startSec * 1000)
    expect(ctrl.xExtent[1]).toBe(endSec * 1000)
    // chartDuration must be in ms so it's comparable to Zoom.mapValue keys (also ms).
    const chartDuration = ctrl.xExtent[1] - ctrl.xExtent[0]
    expect(chartDuration).toBeGreaterThan(Zoom.mapValue('week')) // 6.048e8 ms
    expect(chartDuration).toBeGreaterThan(Zoom.mapValue('day')) // 8.64e7 ms
    expect(chartDuration).toBeLessThan(Zoom.mapValue('year'))
  })
})
