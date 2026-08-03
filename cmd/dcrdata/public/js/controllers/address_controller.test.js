import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Zoom from '../helpers/zoom_helper'

// Stub the @hotwired/stimulus import so the controller module loads in jsdom.
vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

// Mocks for address_controller dependencies.
vi.mock('../helpers/humanize_helper', () => ({
  default: { date: vi.fn(() => 'formatted-date'), timeSince: vi.fn(() => '2m ago') }
}))
const mockRequestJSON = vi.fn(() => Promise.resolve({ html: '' }))
vi.mock('../helpers/http', () => ({ requestJSON: mockRequestJSON }))

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
  it('keeps the selected zoom button visible when the range is below its threshold', () => {
    // 14 days of history (ms). Month threshold = Zoom.mapValue('month') = 2.628e9 ms, so a
    // 14-day chartDuration (1.2096e9) is below it. However, a selected zoom button must
    // survive the gate — hiding it would deselect the control, leaving it reading as empty.
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 14 * 86400 * 1000]
    const zoomMonth = makeBtn('month', { selected: true })
    c.zoomButtons = [makeBtn('all', { fixed: true }), makeBtn('year'), zoomMonth]
    c.binputs = []

    c.setButtonVisibility()

    expect(zoomMonth.has('d-hide')).toBe(false)
    expect(zoomMonth.has('btn-selected')).toBe(true)
  })

  it('keeps a button visible when duration equals its threshold', () => {
    // Exactly 1 day of data (ms). Day threshold = Zoom.mapValue('day') = 8.64e7 ms.
    // With strict > the Day button would be hidden; with >= it stays visible. Week
    // (6.048e8) is coarser so it still hides.
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 86400000]
    const zoomDay = makeBtn('day')
    const zoomWeek = makeBtn('week')
    c.zoomButtons = [makeBtn('all', { fixed: true, selected: true }), zoomWeek, zoomDay]
    c.binputs = []
    c.setButtonVisibility()
    expect(zoomDay.has('d-hide')).toBe(false)
    expect(zoomWeek.has('d-hide')).toBe(true)
  })

  it('keeps all Group By buttons visible regardless of chart duration', () => {
    // Group By buttons control data aggregation, not zoom. They must always be
    // available so the user can return to the default grouping at any time.
    const c = makeRenderController('types', 0, {})
    c.xExtent = [0, 14 * 86400 * 1000] // 14 days
    const yearBin = makeBtn('year')
    const weekBin = makeBtn('week')
    c.binputs = [yearBin, weekBin]
    c.zoomButtons = []
    c.setButtonVisibility()
    expect(yearBin.has('d-hide')).toBe(false)
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

describe('address _refreshOnBlock', () => {
  function makeRefreshController() {
    const ctrl = new AddressController(document.createElement('div'))
    ctrl.dcrAddress = 'abc'
    ctrl.paginationParams = { offset: 40, count: 25, pagesize: 20, txntype: 'all' }
    // Stub the txnType/pageSize getters (they read from DOM selects).
    Object.defineProperty(ctrl, 'txnType', { value: 'all', configurable: true })
    Object.defineProperty(ctrl, 'pageSize', { value: 20, configurable: true })
    ctrl.fetchTable = vi.fn().mockResolvedValue(undefined)
    ctrl.refreshSummary = vi.fn().mockResolvedValue(undefined)
    ctrl.settings = { chart: 'balance', bin: 'all', coin: null }
    ctrl.state = { chart: 'balance', bin: 'all', coin: null }
    ctrl.retrievedData = { 'amountflow-all-0': { dummy: true } }
    // effectiveCoin() falls back to activeCoins[0] or 0 when settings.coin is null.
    ctrl.activeCoins = [0]
    return ctrl
  }

  beforeEach(() => {
    mockRequestJSON.mockReset()
  })

  it('re-fetches the table, refreshes summary, and force-redraws chart', async () => {
    const ctrl = makeRefreshController()
    const graphSpy = vi.spyOn(ctrl, 'drawGraph').mockImplementation(() => {})

    await ctrl._refreshOnBlock()

    // Cache key uses effectiveCoin(), not state.coin (which is null by default).
    expect(Object.prototype.hasOwnProperty.call(ctrl.retrievedData, 'amountflow-all-0')).toBe(false)
    expect(ctrl.state.chart).toBe('__force_refetch__')
    expect(graphSpy).toHaveBeenCalled()
  })

  it('skips the summary refresh when the table fetch fails', async () => {
    const ctrl = makeRefreshController()
    ctrl.fetchTable.mockRejectedValue(new Error('boom'))

    await expect(ctrl._refreshOnBlock()).resolves.toBeUndefined()

    expect(ctrl.refreshSummary).not.toHaveBeenCalled()
  })
})

describe('address applyBlockStats', () => {
  function makeStatsController() {
    const ctrl = new AddressController(document.createElement('div'))
    ctrl.paginationParams = { count: 0 }
    const countEl = document.createElement('span')
    countEl.dataset.txnCount = '0'
    ctrl.hasTxnCountTarget = true
    ctrl.txnCountTarget = countEl
    ctrl.numUnconfirmedTargets = []
    return ctrl
  }

  function makeUnconfirmedCounter(coinType, count) {
    const el = document.createElement('div')
    el.dataset.addressTarget = 'numUnconfirmed'
    el.dataset.coinType = String(coinType)
    el.dataset.count = String(count)
    el.innerHTML = `<span class="addr-unconfirmed-count">${count}</span>`
    return el
  }

  it('updates the header tx count from tx_count', () => {
    const ctrl = makeStatsController()

    ctrl.applyBlockStats({ tx_count: 27, unconfirmed_by_coin: {} })

    expect(ctrl.paginationParams.count).toBe(27)
    expect(ctrl.txnCountTarget.dataset.txnCount).toBe('27')
    expect(ctrl.txnCountTarget.textContent).toBe('27')
  })

  it('does not touch the count when tx_count is absent', () => {
    const ctrl = makeStatsController()
    ctrl.paginationParams.count = 5
    ctrl.txnCountTarget.dataset.txnCount = '5'

    ctrl.applyBlockStats({ unconfirmed_by_coin: {} })

    expect(ctrl.paginationParams.count).toBe(5)
    expect(ctrl.txnCountTarget.dataset.txnCount).toBe('5')
  })

  it('sets per-coin unconfirmed counters from the response', () => {
    const ctrl = makeStatsController()
    const varUnconf = makeUnconfirmedCounter(0, 1)
    const skaUnconf = makeUnconfirmedCounter(1, 3)
    ctrl.numUnconfirmedTargets = [varUnconf, skaUnconf]

    ctrl.applyBlockStats({ tx_count: 10, unconfirmed_by_coin: { 0: 2, 1: 0 } })

    expect(varUnconf.dataset.count).toBe('2')
    expect(varUnconf.querySelector('.addr-unconfirmed-count').textContent).toBe('2')
    expect(varUnconf.classList.contains('d-hide')).toBe(false)
    // Coin 1 is now zero — hidden but still a target so it can reappear later.
    expect(skaUnconf.dataset.count).toBe('0')
    expect(skaUnconf.classList.contains('d-hide')).toBe(true)
    expect(skaUnconf.dataset.addressTarget).toBe('numUnconfirmed')
  })

  it('shows a badge that was hidden (zero at load) once a pending tx arrives', () => {
    const ctrl = makeStatsController()
    const varUnconf = makeUnconfirmedCounter(0, 0)
    varUnconf.classList.add('d-hide')
    ctrl.numUnconfirmedTargets = [varUnconf]

    ctrl.applyBlockStats({ tx_count: 10, unconfirmed_by_coin: { 0: 1 } })

    expect(varUnconf.classList.contains('d-hide')).toBe(false)
    expect(varUnconf.dataset.count).toBe('1')
    expect(varUnconf.querySelector('.addr-unconfirmed-count').textContent).toBe('1')
  })

  it('defaults missing coin types to zero', () => {
    const ctrl = makeStatsController()
    const varUnconf = makeUnconfirmedCounter(0, 1)
    ctrl.numUnconfirmedTargets = [varUnconf]

    ctrl.applyBlockStats({ tx_count: 10, unconfirmed_by_coin: { 1: 4 } })

    expect(varUnconf.dataset.count).toBe('0')
    expect(varUnconf.classList.contains('d-hide')).toBe(true)
  })

  it('hides badges when unconfirmed_by_coin is missing', () => {
    const ctrl = makeStatsController()
    const varUnconf = makeUnconfirmedCounter(0, 1)
    ctrl.numUnconfirmedTargets = [varUnconf]

    ctrl.applyBlockStats({ tx_count: 10 })

    expect(varUnconf.dataset.count).toBe('0')
    expect(varUnconf.classList.contains('d-hide')).toBe(true)
  })

  it('hides badges when unconfirmed_by_coin is null (no mempool entries)', () => {
    const ctrl = makeStatsController()
    const varUnconf = makeUnconfirmedCounter(0, 1)
    ctrl.numUnconfirmedTargets = [varUnconf]

    ctrl.applyBlockStats({ tx_count: 10, unconfirmed_by_coin: null })

    expect(varUnconf.dataset.count).toBe('0')
    expect(varUnconf.classList.contains('d-hide')).toBe(true)
  })
})

describe('address refreshSummary', () => {
  function makeSummaryController() {
    const host = document.createElement('div')
    host.innerHTML = '<div data-address-summary><div>Old summary</div></div>'
    const ctrl = new AddressController(host)
    ctrl.dcrAddress = 'abc'
    return ctrl
  }

  beforeEach(() => {
    mockRequestJSON.mockReset()
  })

  it('replaces the summary card with the sanitized server html', async () => {
    const ctrl = makeSummaryController()
    const newHtml = '<div data-address-summary><div>New summary</div></div>'
    mockRequestJSON.mockResolvedValue({ html: newHtml })

    await ctrl.refreshSummary()

    expect(mockRequestJSON).toHaveBeenCalledWith('/addresssummary/abc')
    expect(ctrl.element.querySelector('[data-address-summary]').textContent).toContain(
      'New summary'
    )
  })

  it('ignores a stale response superseded by a newer request', async () => {
    const ctrl = makeSummaryController()
    const stale = Promise.resolve({ html: '<div data-address-summary>stale</div>' })
    const fresh = Promise.resolve({ html: '<div data-address-summary>fresh</div>' })
    mockRequestJSON.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)

    const p1 = ctrl.refreshSummary()
    const p2 = ctrl.refreshSummary()
    await Promise.all([p1, p2])

    expect(ctrl.element.querySelector('[data-address-summary]').textContent).toContain('fresh')
  })

  it('keeps the current summary when the fetch fails', async () => {
    const ctrl = makeSummaryController()
    mockRequestJSON.mockRejectedValue(new Error('boom'))

    await expect(ctrl.refreshSummary()).resolves.toBeUndefined()

    expect(ctrl.element.querySelector('[data-address-summary]').textContent).toContain(
      'Old summary'
    )
  })

  it('is a no-op when no summary card exists in the DOM', async () => {
    const ctrl = new AddressController(document.createElement('div'))
    ctrl.dcrAddress = 'abc'

    await expect(ctrl.refreshSummary()).resolves.toBeUndefined()

    expect(mockRequestJSON).toHaveBeenCalledWith('/addresssummary/abc')
  })
})
