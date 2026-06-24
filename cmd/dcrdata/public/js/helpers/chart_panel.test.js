import { afterEach, describe, expect, it, vi } from 'vitest'

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
})
