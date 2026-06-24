// A reusable uPlot chart panel: owns one chart's full lifecycle (chart handle + tooltip +
// optional ranger + theme + resize) so page controllers stop hand-rolling it. Composition,
// not a Stimulus base — a controller creates one panel per chart. See
// docs/superpowers/specs/2026-06-24-reusable-chart-panel-design.md.

import { darkEnabled } from '../services/theme_service'
import { createChart, resolveSeriesColor } from './uplot_adapter'

export function createChartPanel(chartEl, opts = {}) {
  return new ChartPanel(chartEl, opts)
}

class ChartPanel {
  constructor(chartEl, { dark, xTime, rangerEl, formatX, onRangeChange } = {}) {
    this.chartEl = chartEl
    this.rangerEl = rangerEl || null
    this.xTime = xTime !== false
    this.formatX = typeof formatX === 'function' ? formatX : (x) => String(x)
    this.onRangeChange = typeof onRangeChange === 'function' ? onRangeChange : null
    this._handle = null
    this._ranger = null
    this.currentDef = null
    this.payload = null
    this.legendElement = null
    this.touchActive = false
    this.epoch = 0
    this._dark = dark != null ? dark : darkEnabled()
    this._destroyed = false
  }

  get handle() {
    return this._handle
  }

  get ranger() {
    return this._ranger
  }

  // (Re)build for `def`, feed `payload`, retain it for the tooltip. Recreates the handle on a
  // def REFERENCE change (not def.name), else setData. Async: createChart is async, so the
  // epoch guard also serializes overlapping renders.
  async render(def, payload, settings) {
    if (this._destroyed) return
    const epoch = ++this.epoch
    const cols = def.toColumns(payload || {}, settings || {})
    await this._ensureChart(def, epoch)
    if (epoch !== this.epoch || this._destroyed) return
    this.payload = payload
    this._handle.setData(cols)
  }

  async _ensureChart(def, epoch) {
    if (this._handle && def === this.currentDef) return // reuse
    if (this._ranger) {
      this._ranger.destroy()
      this._ranger = null
    }
    if (this._handle) {
      this._handle.destroy()
      this._handle = null
    }
    const handle = await createChart(this.chartEl, def, {
      dark: this._dark,
      width: this.chartEl.clientWidth || 800,
      height: this.chartEl.clientHeight || 300,
      xTime: this.xTime,
      hooks: this._buildHooks()
    })
    if (epoch !== this.epoch || this._destroyed) {
      handle.destroy()
      return
    }
    this._handle = handle
    this.currentDef = def
  }

  _buildHooks() {
    return {
      ready: [(u) => this.installTooltip(u)],
      setCursor: [(u) => this.renderLegend(u)]
    }
  }

  // Self-contained on-plot tooltip: a div appended to u.over, shown on cursor-enter,
  // hidden on leave. No per-page seed nodes.
  installTooltip(u) {
    if (!u || !u.over) return
    const tt = document.createElement('div')
    tt.className = 'chart-tooltip d-hide'
    u.over.appendChild(tt)
    this.legendElement = tt
    u.over.addEventListener('mouseenter', () => tt.classList.remove('d-hide'))
    u.over.addEventListener('mouseleave', () => {
      if (!u.cursor || !u.cursor._lock) tt.classList.add('d-hide')
    })
  }

  // Build a legend row node. Self-contained marker reusing the global .dygraph-legend-line CSS.
  _legendRow(html) {
    const node = document.createElement('div')
    node.className = 'pe-3'
    node.innerHTML = html
    return node
  }

  _marker(color) {
    const span = document.createElement('span')
    span.className = 'dygraph-legend-line'
    if (color) span.style.borderBottomColor = color
    return span.outerHTML
  }

  // Fill the tooltip at the cursor index: x-label row, then one row per VISIBLE series.
  // Reads the retained raw payload via def.formatValue (firewall), never the plotted columns.
  renderLegend(u) {
    const tt = this.legendElement
    if (!tt) return
    const idx = u.cursor.idx
    if (idx == null) {
      tt.classList.add('d-hide')
      return
    }
    tt.classList.remove('d-hide')
    tt.replaceChildren()
    const x = u.data[0][idx]
    tt.appendChild(this._legendRow(this.formatX(x)))
    const dark = this._dark
    const payload = this.payload
    this.currentDef.series.forEach((s, i) => {
      if (u.series && u.series[i + 1] && u.series[i + 1].show === false) return
      const value = u.data[i + 1][idx]
      if (value == null) return
      const text = this.currentDef.formatValue(i, { idx, payload, value }, {})
      const color = resolveSeriesColor(s, i, dark)
      tt.appendChild(this._legendRow(`${this._marker(color)} ${s.label}: ${text}`))
    })
    this.positionTooltip(u)
  }

  positionTooltip(u) {
    const tt = this.legendElement
    if (!u.over || !tt || !tt.style) return
    const pad = 12
    if (this.touchActive) {
      const w = tt.offsetWidth
      const h = tt.offsetHeight
      let left = u.cursor.left - w - pad
      if (left < 0) left = u.cursor.left + pad
      left = Math.max(0, Math.min(left, u.over.clientWidth - w))
      let top = u.cursor.top - h - pad
      if (top < 0) top = u.cursor.top + pad
      top = Math.max(0, Math.min(top, u.over.clientHeight - h))
      tt.style.left = `${left}px`
      tt.style.top = `${top}px`
      return
    }
    let left = u.cursor.left + pad
    let top = u.cursor.top + pad
    if (left + tt.offsetWidth > u.over.clientWidth) left = u.cursor.left - tt.offsetWidth - pad
    if (top + tt.offsetHeight > u.over.clientHeight) top = u.cursor.top - tt.offsetHeight - pad
    tt.style.left = `${Math.max(0, left)}px`
    tt.style.top = `${Math.max(0, top)}px`
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    if (this._handle) {
      this._handle.destroy()
      this._handle = null
    }
    if (this._ranger) {
      this._ranger.destroy()
      this._ranger = null
    }
  }
}
