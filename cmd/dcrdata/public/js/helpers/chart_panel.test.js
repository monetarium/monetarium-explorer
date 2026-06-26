import { afterEach, describe, expect, it, vi } from 'vitest'
import globalEventBus from '../services/event_bus_service'

// Mock the adapter + ranger so no real uPlot is needed. Factories push each fake onto a
// list so tests can inspect per-render instances. References are lazy (inside the vi.fn
// body), so vitest's hoisting of vi.mock above these declarations is fine.
const makeFakeHandle = () => ({
  uplot: { data: [[]], scales: { x: {} }, over: null, root: null, setCursor: vi.fn() },
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
vi.mock('./uplot_adapter', () => ({
  createChart: vi.fn(() => {
    const h = makeFakeHandle()
    fakeHandles.push(h)
    return Promise.resolve(h)
  }),
  resolveSeriesColor: vi.fn(() => 'rgb(1,2,3)')
}))
vi.mock('./uplot_ranger', () => ({
  createRanger: vi.fn(() => {
    const r = makeFakeRanger()
    fakeRangers.push(r)
    return Promise.resolve(r)
  })
}))
vi.mock('../services/theme_service', () => ({ darkEnabled: vi.fn(() => false) }))
vi.mock('../services/event_bus_service', () => ({ default: { on: vi.fn(), off: vi.fn() } }))

const { createChartPanel } = await import('./chart_panel.js')

afterEach(() => {
  fakeHandles = []
  fakeRangers = []
  vi.clearAllMocks()
})

const defA = {
  name: 'a',
  series: [{ label: 'Yes', color: '#009900', kind: 'area' }],
  stacked: true,
  toColumns: (p) => [p.x, p.yes],
  formatValue: (i, d) => String(d.payload.yes[d.idx])
}
const payload1 = { x: [1, 2], yes: [10, 30] }

describe('ChartPanel core lifecycle', () => {
  it('render creates a handle and feeds the def columns', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    expect(p.handle).toBeTruthy()
    expect(p.handle.setData).toHaveBeenCalledWith([
      [1, 2],
      [10, 30]
    ])
  })
  it('render reuses the handle when the same def object is passed again (setData, no recreate)', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const first = p.handle
    await p.render(defA, { x: [1, 2], yes: [11, 31] }, {})
    expect(p.handle).toBe(first)
    expect(first.destroy).not.toHaveBeenCalled()
    expect(first.setData).toHaveBeenCalledTimes(2)
  })
  it('render recreates the handle when a DIFFERENT def object is passed (reference identity)', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const first = p.handle
    const defB = { ...defA, name: 'a' } // same name, different object
    await p.render(defB, payload1, {})
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(p.handle).not.toBe(first)
  })
  it('render retains the raw payload (firewall)', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    expect(p.payload).toBe(payload1)
  })
  it('destroy tears down the handle', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const h = p.handle
    p.destroy()
    expect(h.destroy).toHaveBeenCalledTimes(1)
    expect(p.handle).toBeNull()
  })
})

describe('ChartPanel tooltip', () => {
  function uStub(idx) {
    return {
      cursor: { idx: idx, left: 50, top: 20 },
      data: [
        [1, 2],
        [10, 30]
      ],
      series: [{}, { show: true }],
      over: { clientWidth: 800, clientHeight: 300, appendChild: vi.fn(), addEventListener: vi.fn() }
    }
  }
  it('renderLegend emits an x-label row and per-series formatValue rows', async () => {
    const p = createChartPanel(document.createElement('div'), { formatX: (x) => `X: ${x}` })
    await p.render(defA, payload1, {})
    p.legendElement = document.createElement('div')
    p.renderLegend(uStub(1))
    const txt = p.legendElement.textContent
    expect(txt).toContain('X: 2')
    expect(txt).toContain('Yes: 30')
  })
  it('renderLegend no-ops before the def is set (currentDef-null gap)', () => {
    const p = createChartPanel(document.createElement('div'), {})
    p.legendElement = document.createElement('div')
    // currentDef is still null (a setCursor hook can fire before createChart resolves)
    expect(() => p.renderLegend({ cursor: { idx: 0 }, data: [[1], [2]] })).not.toThrow()
  })
  it('renderLegend hides the tooltip when idx is null', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    p.legendElement = document.createElement('div')
    p.renderLegend({ cursor: { idx: null }, data: [[]] })
    expect(p.legendElement.classList.contains('d-hide')).toBe(true)
  })
  it('renderLegend skips a hidden series', async () => {
    const p = createChartPanel(document.createElement('div'), { formatX: (x) => `X: ${x}` })
    await p.render(defA, payload1, {})
    p.legendElement = document.createElement('div')
    const u = uStub(1)
    u.series[1].show = false
    p.renderLegend(u)
    expect(p.legendElement.textContent).not.toContain('Yes:')
  })
  it('reads the raw payload value, not the cumulative plotted value, for a stacked def (firewall)', async () => {
    // The amountflow regression guard, ported to the panel where the firewall now lives: uPlot
    // stacks the plotted columns, so u.data carries the CUMULATIVE value (Net Received plots at
    // 20 = received10 + net10), but formatValue reads the RAW payload (net10) — the tooltip must
    // show 10, never the cumulative 20.
    const stackedDef = {
      name: 'flow',
      series: [
        { label: 'Received', color: '#0a0', kind: 'bars' },
        { label: 'Net Received', color: '#00a', kind: 'bars' }
      ],
      stacked: true,
      toColumns: (p) => [p.x, p.received, p.net],
      formatValue: (i, d) => `${[d.payload.received, d.payload.net][i][d.idx]} VAR`
    }
    const p = createChartPanel(document.createElement('div'), { formatX: (x) => `X: ${x}` })
    await p.render(stackedDef, { x: [1], received: [10], net: [10] }, {})
    p.legendElement = document.createElement('div')
    p.renderLegend({
      cursor: { idx: 0, left: 10, top: 10 },
      data: [[1], [10], [20]], // plotted: Received=10, Net Received cumulative=20
      series: [{}, { show: true }, { show: true }],
      over: { clientWidth: 800, clientHeight: 300 }
    })
    const txt = p.legendElement.textContent
    expect(txt).toContain('Net Received: 10 VAR') // raw payload value
    expect(txt).not.toContain('Net Received: 20 VAR') // NOT the cumulative plotted value
  })
  it('skips a zero-formatted series row only when the def opts in via skipZeroRows', async () => {
    const zeroDef = {
      name: 'z',
      series: [
        { label: 'A', color: '#0a0', kind: 'bars' },
        { label: 'B', color: '#00a', kind: 'bars' }
      ],
      stacked: true,
      skipZeroRows: true,
      toColumns: (p) => [p.x, p.a, p.b],
      // A -> "0 VAR" (skipped), B -> "5 VAR" (kept)
      formatValue: (i, d) => `${[d.payload.a, d.payload.b][i][d.idx]} VAR`
    }
    const p = createChartPanel(document.createElement('div'), { formatX: (x) => `X: ${x}` })
    await p.render(zeroDef, { x: [1], a: [0], b: [5] }, {})
    p.legendElement = document.createElement('div')
    p.renderLegend({
      cursor: { idx: 0, left: 10, top: 10 },
      data: [[1], [0], [5]],
      series: [{}, { show: true }, { show: true }],
      over: { clientWidth: 800, clientHeight: 300 }
    })
    const txt = p.legendElement.textContent
    expect(txt).not.toContain('A: 0 VAR') // zero row skipped (skipZeroRows)
    expect(txt).toContain('B: 5 VAR') // non-zero row kept
  })
  it('keeps a zero-formatted row when the def does NOT set skipZeroRows (default)', async () => {
    const keepDef = {
      name: 'k',
      series: [{ label: 'A', color: '#0a0', kind: 'bars' }],
      stacked: true,
      toColumns: (p) => [p.x, p.a],
      formatValue: (i, d) => `${d.payload.a[d.idx]} VAR`
    }
    const p = createChartPanel(document.createElement('div'), { formatX: (x) => `X: ${x}` })
    await p.render(keepDef, { x: [1], a: [0] }, {})
    p.legendElement = document.createElement('div')
    p.renderLegend({
      cursor: { idx: 0, left: 10, top: 10 },
      data: [[1], [0]],
      series: [{}, { show: true }],
      over: { clientWidth: 800, clientHeight: 300 }
    })
    expect(p.legendElement.textContent).toContain('A: 0 VAR')
  })
})

describe('ChartPanel touch-scrub', () => {
  function overStub() {
    const listeners = {}
    return {
      style: {},
      clientWidth: 800,
      clientHeight: 300,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 300 }),
      appendChild: vi.fn(),
      dispatchEvent: vi.fn(),
      addEventListener: (type, fn) => {
        ;(listeners[type] ||= []).push(fn)
      },
      _fire: (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev)),
      _listeners: listeners
    }
  }
  it('a horizontal touch drag scrubs the cursor; a vertical one does not', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const over = overStub()
    const u = { over: over, cursor: {}, setCursor: vi.fn() }
    p.installTooltip(u) // installs touch listeners on over
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchmove', { touches: [{ clientX: 140, clientY: 102 }], preventDefault: () => {} }) // dx=40 horizontal
    expect(u.setCursor).toHaveBeenCalledTimes(1)
    expect(over.style.touchAction).toBe('pan-y')
    // vertical drag from a fresh gesture
    u.setCursor.mockClear()
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchmove', { touches: [{ clientX: 102, clientY: 140 }], preventDefault: () => {} }) // dy dominant
    expect(u.setCursor).not.toHaveBeenCalled()
  })
  it('two quick taps in the same spot dispatch a dblclick (zoom reset)', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const over = overStub()
    const u = { over: over, cursor: {}, setCursor: vi.fn() }
    p.installTooltip(u)
    // tap 1
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchend', {})
    // tap 2 (same spot, immediately) -> double-tap
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchend', {})
    expect(over.dispatchEvent).toHaveBeenCalledTimes(1)
    expect(over.dispatchEvent.mock.calls[0][0].type).toBe('dblclick')
  })
  it('a single tap does not dispatch a dblclick', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const over = overStub()
    const u = { over: over, cursor: {}, setCursor: vi.fn() }
    p.installTooltip(u)
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchend', {})
    expect(over.dispatchEvent).not.toHaveBeenCalled()
  })
  it('a scroll between two taps breaks the double-tap sequence (no false reset)', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defA, payload1, {})
    const over = overStub()
    const u = { over: over, cursor: {}, setCursor: vi.fn() }
    p.installTooltip(u)
    // tap 1
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchend', {})
    // a vertical scroll gesture (locks to 'scroll') then lifts
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchmove', { touches: [{ clientX: 102, clientY: 160 }], preventDefault: () => {} })
    over._fire('touchend', {})
    // tap 2 in the same spot — must NOT pair with tap 1 across the scroll
    over._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }] })
    over._fire('touchend', {})
    expect(over.dispatchEvent).not.toHaveBeenCalled()
  })
})

const defWithRanger = { ...defA }

describe('ChartPanel ranger', () => {
  it('render creates a ranger and seeds the full-extent selection (epoch-guarded, deferred)', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {})
    expect(p.ranger).toBeTruthy()
    expect(p.ranger.setData).toHaveBeenCalledWith([
      [1, 2],
      [10, 30]
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(p.ranger.setSelection).toHaveBeenCalledWith(1, 2)
  })
  it('no ranger when rangerEl is omitted', async () => {
    const p = createChartPanel(document.createElement('div'), {})
    await p.render(defWithRanger, payload1, {})
    expect(p.ranger).toBeNull()
  })
  it('a superseded render leaves only the latest ranger seeded (epoch guard)', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    const r1 = p.render(defWithRanger, payload1, {})
    const r2 = p.render({ ...defWithRanger }, { x: [5, 6], yes: [1, 2] }, {})
    await Promise.all([r1, r2])
    await new Promise((resolve) => setTimeout(resolve, 0))
    const latest = fakeRangers[fakeRangers.length - 1]
    expect(latest.setSelection).toHaveBeenCalledWith(5, 6)
    fakeRangers.slice(0, -1).forEach((r) => expect(r.setSelection).not.toHaveBeenCalledWith(1, 2))
  })
  it('setXRange drives both handle and ranger', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {})
    p.setXRange(100, 200)
    expect(p.handle.setXRange).toHaveBeenCalledWith(100, 200)
    expect(p.ranger.setSelection).toHaveBeenCalledWith(100, 200)
  })

  it('seeds the ranger via a custom rangerData selector', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div'),
      rangerData: (cols) => [cols[0], cols[1].map((v) => v * 2)]
    })
    const def = {
      ...defA,
      toColumns: () => [
        [1, 2],
        [10, 30]
      ]
    }
    await p.render(def, payload1, {})
    expect(p.ranger.setData).toHaveBeenCalledWith([
      [1, 2],
      [20, 60]
    ])
  })

  it('builds the ranger from rangerDef when provided (not the chart def)', async () => {
    const { createRanger } = await import('./uplot_ranger.js')
    const rangerDef = { ...defA, name: 'strip-only' }
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div'),
      rangerDef: rangerDef
    })
    await p.render(defA, payload1, {})
    expect(createRanger).toHaveBeenCalledWith(expect.anything(), rangerDef, expect.anything())
  })

  it('a ranger drag drives the chart AND notifies onRangeChange', async () => {
    const onRangeChange = vi.fn()
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div'),
      onRangeChange: onRangeChange
    })
    await p.render(defWithRanger, payload1, {})
    const { createRanger } = await import('./uplot_ranger.js')
    const onSelect = createRanger.mock.calls.at(-1)[2].onSelect
    onSelect(100, 200) // simulate a ranger grip drag
    expect(p.handle.setXRange).toHaveBeenCalledWith(100, 200)
    expect(onRangeChange).toHaveBeenCalledWith(100, 200)
  })
  it('a ranger drag is a no-op for onRangeChange when none is provided (agenda/ticketpool)', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {})
    const { createRanger } = await import('./uplot_ranger.js')
    const onSelect = createRanger.mock.calls.at(-1)[2].onSelect
    expect(() => onSelect(100, 200)).not.toThrow()
    expect(p.handle.setXRange).toHaveBeenCalledWith(100, 200)
  })
})

describe('ChartPanel target range on render', () => {
  it('preserveRange keeps the current x-range across a same-def update (chart + ranger)', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {})
    p.handle.uplot.scales.x = { min: 5, max: 9 } // user zoomed
    p.handle.setXRange.mockClear()
    p.ranger.setSelection.mockClear()
    await p.render(defWithRanger, { x: [1, 2, 3], yes: [4, 5, 6] }, {}, { preserveRange: true })
    expect(p.handle.setXRange).toHaveBeenCalledWith(5, 9)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(p.ranger.setSelection).toHaveBeenCalledWith(5, 9)
  })

  it('preserveRange is a no-op on a fresh build (no prior finite range) -> full extent', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {}, { preserveRange: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(p.ranger.setSelection).toHaveBeenCalledWith(1, 2) // full extent of payload1
  })

  it('explicit range seeds the chart + ranger even across a rebuild (different def)', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {})
    const firstHandle = p.handle
    await p.render(
      { ...defWithRanger },
      { x: [10, 20, 30], yes: [1, 2, 3] },
      {},
      {
        range: { min: 12, max: 28 }
      }
    )
    expect(firstHandle.destroy).toHaveBeenCalledTimes(1) // rebuilt
    expect(p.handle.setXRange).toHaveBeenCalledWith(12, 28)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(p.ranger.setSelection).toHaveBeenCalledWith(12, 28)
  })
})

describe('ChartPanel rangerSeedOnce (fixed overview)', () => {
  it('persists the ranger across a def-change rebuild and seeds its data only once', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div'),
      rangerSeedOnce: true
    })
    await p.render(defWithRanger, payload1, {})
    const ranger = p.ranger
    expect(ranger).toBeTruthy()
    expect(ranger.setData).toHaveBeenCalledTimes(1) // seeded once on creation
    ranger.setData.mockClear()
    ranger.setSelection.mockClear()
    // bars change: a DIFFERENT def reference forces a chart rebuild
    await p.render(
      { ...defWithRanger },
      { x: [10, 20, 30], yes: [1, 2, 3] },
      {},
      { range: { min: 12, max: 28 } }
    )
    expect(p.handle).not.toBe(undefined)
    expect(fakeRangers.length).toBe(1) // no second ranger created
    expect(p.ranger).toBe(ranger) // same ranger instance survives the rebuild
    expect(ranger.destroy).not.toHaveBeenCalled()
    expect(ranger.setData).not.toHaveBeenCalled() // NOT re-seeded from the (coarse) cols
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ranger.setSelection).toHaveBeenCalledWith(12, 28) // only the selection moves
  })

  it('does not re-seed ranger data on a same-def update either (frozen overview)', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div'),
      rangerSeedOnce: true
    })
    await p.render(defWithRanger, payload1, {})
    const ranger = p.ranger
    ranger.setData.mockClear()
    p.handle.uplot.scales.x = { min: 1, max: 2 }
    await p.render(defWithRanger, { x: [1, 2, 3], yes: [4, 5, 6] }, {}, { preserveRange: true })
    expect(ranger.setData).not.toHaveBeenCalled()
  })
})

describe('ChartPanel theme + resize + destroy cleanup', () => {
  it('registers and removes NIGHT_MODE + resize listeners across its lifecycle', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const p = createChartPanel(document.createElement('div'), {})
    expect(globalEventBus.on).toHaveBeenCalledWith('NIGHT_MODE', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    await p.render(defA, payload1, {})
    p.destroy()
    expect(globalEventBus.off).toHaveBeenCalledWith('NIGHT_MODE', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
  it('_setDark recolors the handle and re-applies the ranger selection', async () => {
    const p = createChartPanel(document.createElement('div'), {
      rangerEl: document.createElement('div')
    })
    await p.render(defWithRanger, payload1, {}) // panel starts light (darkEnabled mock -> false)
    p.handle.uplot.scales.x = { min: 1, max: 2 }
    p.ranger.setSelection.mockClear()
    p._setDark(true)
    expect(p.handle.setDark).toHaveBeenCalledWith(true)
    expect(p.ranger.setDark).toHaveBeenCalledWith(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(p.ranger.setSelection).toHaveBeenCalledWith(1, 2)
  })
  it('a theme toggle during an in-flight render does not blank the panel and reconciles the theme', async () => {
    const { createChart } = await import('./uplot_adapter.js')
    const handle = makeFakeHandle()
    let resolveCreate
    createChart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve(handle)
        })
    )
    const p = createChartPanel(document.createElement('div'), {}) // starts light
    const pending = p.render(defA, payload1, {}) // createChart is in flight (awaiting loadUPlot)
    p._setDark(true) // theme toggle lands mid-render
    resolveCreate()
    await pending
    expect(p.handle).toBe(handle) // NOT blanked — the theme epoch must not abort the render
    expect(handle.setDark).toHaveBeenCalledWith(true) // chart reconciled to the new theme
  })
  it('public resize() re-measures the chart from the element dimensions', async () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientWidth', { value: 640, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 480, configurable: true })
    const p = createChartPanel(el, {})
    await p.render(defA, payload1, {})
    p.handle.resize.mockClear()
    p.resize()
    expect(p.handle.resize).toHaveBeenCalledWith(640, 480)
  })
})
