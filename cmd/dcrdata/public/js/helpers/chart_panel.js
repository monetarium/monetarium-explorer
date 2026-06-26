// A reusable uPlot chart panel: owns one chart's full lifecycle (chart handle + tooltip +
// optional ranger + theme + resize) so page controllers stop hand-rolling it. Composition,
// not a Stimulus base — a controller creates one panel per chart. See
// docs/superpowers/specs/2026-06-24-reusable-chart-panel-design.md.

import { debounce } from 'lodash-es'
import globalEventBus from '../services/event_bus_service'
import { darkEnabled } from '../services/theme_service'
import { classifyGesture, isDoubleTap } from './touch_gesture'
import { createChart, resolveSeriesColor } from './uplot_adapter'
import { createRanger } from './uplot_ranger'

const SCRUB_THRESHOLD = 8 // px a touch must travel horizontally to lock into a scrub (mirrors charts)
const RESIZE_DEBOUNCE_MS = 150

export function createChartPanel(chartEl, opts = {}) {
  return new ChartPanel(chartEl, opts)
}

class ChartPanel {
  constructor(
    chartEl,
    { dark, xTime, rangerEl, formatX, onRangeChange, rangerData, rangerDef, rangerSeedOnce } = {}
  ) {
    this.chartEl = chartEl
    this.rangerEl = rangerEl || null
    this.xTime = xTime !== false
    this.formatX = typeof formatX === 'function' ? formatX : (x) => String(x)
    this.onRangeChange = typeof onRangeChange === 'function' ? onRangeChange : null
    this.rangerData = typeof rangerData === 'function' ? rangerData : (cols) => [cols[0], cols[1]]
    this.rangerDef = rangerDef || null
    // Fixed-overview ranger: seed its data once (first render) and keep that instance + data
    // across chart rebuilds; only its selection tracks the chart afterward. Use this when the
    // chart def changes (e.g. bar-aggregation factory) but the ranger must stay a stable,
    // fine-grained overview — re-seeding it with the chart's re-aggregated columns would
    // collapse the strip. Default false: the ranger rebuilds + re-seeds with the chart.
    this.rangerSeedOnce = !!rangerSeedOnce
    this._handle = null
    this._ranger = null
    this.currentDef = null
    this.payload = null
    this.legendElement = null
    this.touchActive = false
    this.epoch = 0 // render generation (overlapping renders + their deferred work)
    this._themeEpoch = 0 // theme generation — kept separate so a theme toggle can't abort a render
    this._dark = dark != null ? dark : darkEnabled()
    this._destroyed = false
    // Page-level listeners (removed in destroy() — the mandatory-destroy invariant).
    this._onNightMode = () => this._setDark(darkEnabled())
    globalEventBus.on('NIGHT_MODE', this._onNightMode)
    this._onWindowResize = debounce(() => this._resize(), RESIZE_DEBOUNCE_MS)
    window.addEventListener('resize', this._onWindowResize)
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
  async render(def, payload, settings, opts = {}) {
    if (this._destroyed) return
    const epoch = ++this.epoch
    const cols = def.toColumns(payload || {}, settings || {})
    const reuse = !!this._handle && def === this.currentDef
    let target = null
    if (opts.range && opts.range.min != null && opts.range.max != null) {
      target = { min: opts.range.min, max: opts.range.max }
    } else if (opts.preserveRange && reuse) {
      const sx = this._handle.uplot.scales.x
      if (sx && sx.min != null && sx.max != null && isFinite(sx.min) && isFinite(sx.max)) {
        target = { min: sx.min, max: sx.max }
      }
    }
    await this._ensureChart(def, epoch)
    if (epoch !== this.epoch || this._destroyed) return
    this.payload = payload
    this._handle.setData(cols)
    if (target) this._handle.setXRange(target.min, target.max)
    await this._ensureRanger(def, cols, epoch, target)
  }

  async _ensureChart(def, epoch) {
    if (this._handle && def === this.currentDef) return // reuse
    // A fixed-overview ranger (rangerSeedOnce) survives a chart rebuild; only the handle below
    // is recreated. Its callbacks read this._handle/this._ranger live, so they re-wire to the
    // fresh handle without rebuilding the strip.
    if (this._ranger && !this.rangerSeedOnce) {
      this._ranger.destroy()
      this._ranger = null
    }
    if (this._handle) {
      this._handle.destroy()
      this._handle = null
    }
    const darkAtBuild = this._dark
    const handle = await createChart(this.chartEl, def, {
      dark: darkAtBuild,
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
    // A theme toggle that landed while createChart was awaiting loadUPlot() couldn't reach the
    // not-yet-assigned handle; reconcile so the chart matches the current theme.
    if (this._dark !== darkAtBuild) handle.setDark(this._dark)
  }

  _buildHooks() {
    return {
      ready: [(u) => this.installTooltip(u)],
      setCursor: [(u) => this.renderLegend(u)],
      draw: [(u) => this.syncRangerGutters(u)]
    }
  }

  async _ensureRanger(def, cols, epoch, target) {
    if (!this.rangerEl) return
    if (!this._ranger) {
      const g = (this._handle && this.measureGutters(this._handle.uplot)) || { left: 0, right: 0 }
      const ranger = await createRanger(this.rangerEl, this.rangerDef || def, {
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
      this._ranger.setData(this.rangerData(cols))
    } else if (!this.rangerSeedOnce) {
      this._ranger.setData(this.rangerData(cols))
    }
    // rangerSeedOnce: data was seeded on creation and must not be overwritten by the chart's
    // (possibly re-aggregated) cols — only the selection below tracks the chart.
    this._seedRangerSelection(cols, epoch, target)
  }

  // Deferred (uPlot commits layout async) + epoch-guarded: align the strip's plot insets to
  // the main chart, then seed the full-extent selection one microtask later.
  _seedRangerSelection(cols, epoch, target) {
    const xs = cols[0]
    queueMicrotask(() => {
      if (epoch !== this.epoch || this._destroyed || !this._ranger) return
      this.syncRangerGutters(this._handle && this._handle.uplot)
      queueMicrotask(() => {
        if (epoch !== this.epoch || this._destroyed || !this._ranger) return
        if (target) this._ranger.setSelection(target.min, target.max)
        else if (xs && xs.length) this._ranger.setSelection(xs[0], xs[xs.length - 1])
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

  // Ranger grip/body drag: drive the main chart (which mirrors back via _onChartRangeChange),
  // and notify the controller so it can persist (e.g. address URL zoom). setXRange is silent
  // (it does not fire the chart's onRangeChange), so this is the only notify on a ranger drag.
  _onRangerSelect(min, max) {
    if (this._handle) this._handle.setXRange(min, max)
    if (this.onRangeChange) this.onRangeChange(min, max)
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
    let lastTap = null
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
        lastTap = null // an intervening gesture breaks the double-tap sequence
      } else if (state === 'pending') {
        // A still finger (never locked to scrub/scroll) is a tap. A second tap close in time
        // and space re-synthesizes the dblclick iOS Safari omits, so uPlot's own reset runs.
        const tap = { t: performance.now(), x: startX, y: startY }
        if (isDoubleTap(lastTap, tap)) {
          u.over.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
          lastTap = null
        } else {
          lastTap = tap
        }
      } else {
        lastTap = null // a scroll between taps also breaks the double-tap sequence
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
    if (!tt || !this.currentDef) return // a setCursor hook can fire before createChart resolves
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
      if (s.show === false) return
      if (u.series && u.series[i + 1] && u.series[i + 1].show === false) return
      const value = u.data[i + 1][idx]
      if (value == null) return
      const text = this.currentDef.formatValue(i, { idx, payload, value }, {})
      if (text === '') return
      // Opt-in (def.skipZeroRows): a stacked chart's many 0-valued series clutter the tooltip.
      // Defaulted off so agenda/ticketpool/charts defs are unaffected; only stacked address
      // defs set the flag. Matches the legacy address `if (def.stacked && /^0/.test(text))`.
      if (this.currentDef.skipZeroRows && /^0(\s|$)/.test(text)) return
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

  // Recolor on a theme change. Guards its deferred re-apply with a SEPARATE theme epoch (not
  // the render epoch): a toggle landing during an in-flight render() must not bump the render
  // epoch, or _ensureChart would abort the just-built handle and blank the panel. Capture the
  // live x-range BEFORE setDark (uPlot commits async), re-apply it to the freshly-rebuilt ranger.
  _setDark(dark) {
    if (this._destroyed || !!this._dark === !!dark) return
    this._dark = dark
    const themeEpoch = ++this._themeEpoch
    const sx = this._handle && this._handle.uplot.scales.x
    const range = sx && sx.min != null && sx.max != null ? [sx.min, sx.max] : null
    if (this._handle) this._handle.setDark(dark)
    if (this._ranger) {
      this._ranger.setDark(dark)
      queueMicrotask(() => {
        if (themeEpoch !== this._themeEpoch || this._destroyed || !this._ranger) return
        if (range) this._ranger.setSelection(range[0], range[1])
        else {
          const xs = this._ranger.uplot.data[0]
          if (xs && xs.length) this._ranger.setSelection(xs[0], xs[xs.length - 1])
        }
      })
    }
  }

  // Re-measure now (no debounce) — for layout changes that fire no window 'resize' event,
  // e.g. a fullscreen-expand DOM move or a show/hide that changes the container size.
  resize() {
    this._resize()
  }

  // Resize does not rebuild, so it does NOT bump the epoch, but it captures+checks it so a
  // later render invalidates this pending re-apply.
  _resize() {
    if (this._destroyed || !this._handle) return
    const epoch = this.epoch
    this._handle.resize(this.chartEl.clientWidth || 800, this.chartEl.clientHeight || 300)
    if (!this._ranger || !this.rangerEl) return
    this._ranger.setWidth(this.rangerEl.clientWidth || 800)
    const sx = this._handle.uplot.scales.x
    if (sx && sx.min != null && sx.max != null) {
      const min = sx.min
      const max = sx.max
      queueMicrotask(() => {
        if (epoch !== this.epoch || this._destroyed || !this._ranger) return
        this._ranger.setSelection(min, max)
      })
    }
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    globalEventBus.off('NIGHT_MODE', this._onNightMode)
    window.removeEventListener('resize', this._onWindowResize)
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
