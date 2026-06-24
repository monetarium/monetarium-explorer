// A reusable uPlot chart panel: owns one chart's full lifecycle (chart handle + tooltip +
// optional ranger + theme + resize) so page controllers stop hand-rolling it. Composition,
// not a Stimulus base — a controller creates one panel per chart. See
// docs/superpowers/specs/2026-06-24-reusable-chart-panel-design.md.

import { darkEnabled } from '../services/theme_service'
import { classifyGesture } from './touch_gesture'
import { createChart, resolveSeriesColor } from './uplot_adapter'
import { createRanger } from './uplot_ranger'

const SCRUB_THRESHOLD = 8 // px a touch must travel horizontally to lock into a scrub (mirrors charts)

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
    await this._ensureRanger(def, cols, epoch)
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
      hooks: this._buildHooks(),
      onRangeChange: (min, max) => this._onChartRangeChange(min, max)
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
      setCursor: [(u) => this.renderLegend(u)],
      draw: [(u) => this.syncRangerGutters(u)]
    }
  }

  async _ensureRanger(def, cols, epoch) {
    if (!this.rangerEl) return
    if (!this._ranger) {
      const g = (this._handle && this.measureGutters(this._handle.uplot)) || { left: 0, right: 0 }
      const ranger = await createRanger(this.rangerEl, def, {
        dark: this._dark,
        width: this.rangerEl.clientWidth || 800,
        xTime: this.xTime,
        leftGutter: g.left,
        rightGutter: g.right,
        onSelect: (min, max) => this._onRangerSelect(min, max)
      })
      if (epoch !== this.epoch || this._destroyed) {
        ranger.destroy()
        return
      }
      this._ranger = ranger
      this._ranger.setData([cols[0], cols[1]])
    } else {
      this._ranger.setData([cols[0], cols[1]])
    }
    this._seedRangerSelection(cols, epoch)
  }

  // Deferred (uPlot commits layout async) + epoch-guarded: align the strip's plot insets to
  // the main chart, then seed the full-extent selection one microtask later.
  _seedRangerSelection(cols, epoch) {
    const xs = cols[0]
    queueMicrotask(() => {
      if (epoch !== this.epoch || this._destroyed || !this._ranger) return
      this.syncRangerGutters(this._handle && this._handle.uplot)
      queueMicrotask(() => {
        if (epoch !== this.epoch || this._destroyed || !this._ranger) return
        if (xs && xs.length) this._ranger.setSelection(xs[0], xs[xs.length - 1])
      })
    })
  }

  measureGutters(u) {
    if (!u || !u.over || !u.root) return null
    const root = u.root.getBoundingClientRect()
    const over = u.over.getBoundingClientRect()
    return { left: over.left - root.left, right: root.right - over.right }
  }

  syncRangerGutters(u) {
    if (!this._ranger) return
    const g = this.measureGutters(u)
    if (g) this._ranger.setGutters(g.left, g.right)
  }

  setXRange(min, max) {
    if (this._handle) this._handle.setXRange(min, max)
    if (this._ranger) this._ranger.setSelection(min, max)
  }

  // Main-chart drag-zoom: mirror to the strip + notify the controller (URL persistence).
  _onChartRangeChange(min, max) {
    if (this._ranger) this._ranger.setSelection(min, max)
    if (this.onRangeChange) this.onRangeChange(min, max)
  }

  // Ranger grip/body drag: drive the main chart (which mirrors back via _onChartRangeChange).
  _onRangerSelect(min, max) {
    if (this._handle) this._handle.setXRange(min, max)
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
    this.installTouchScrub(u, tt)
  }

  // Touch parity for the hover tooltip: a horizontal finger drag scrubs the cursor (same
  // setCursor -> renderLegend path as the mouse); a vertical drag yields to page scroll.
  // pending -> scrub | scroll, terminal until touchend/cancel. Ported from charts_controller.
  installTouchScrub(u, tt) {
    let startX = 0
    let startY = 0
    let state = 'pending'
    this.touchActive = false
    u.over.style.touchAction = 'pan-y' // self-contained: no per-page CSS
    u.over.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches && e.touches[0]
        if (!t) return
        startX = t.clientX
        startY = t.clientY
        state = 'pending'
      },
      { passive: true }
    )
    u.over.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches && e.touches[0]
        if (!t) return
        if (state === 'pending') {
          state = classifyGesture(t.clientX - startX, t.clientY - startY, SCRUB_THRESHOLD)
        }
        if (state !== 'scrub') return
        this.touchActive = true
        e.preventDefault()
        const rect = u.over.getBoundingClientRect()
        const left = Math.max(0, Math.min(t.clientX - rect.left, rect.width))
        const top = Math.max(0, Math.min(t.clientY - rect.top, rect.height))
        u.setCursor({ left: left, top: top })
      },
      { passive: false }
    )
    const end = () => {
      if (state === 'scrub') {
        tt.classList.add('d-hide')
        u.setCursor({ left: -10, top: -10 })
      }
      state = 'pending'
      this.touchActive = false
    }
    u.over.addEventListener('touchend', end)
    u.over.addEventListener('touchcancel', end)
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
