/* global Turbolinks */
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import Zoom from '../helpers/zoom_helper'
import { animationFrame } from '../helpers/animation_helper' // eslint-disable-line no-unused-vars
import globalEventBus from '../services/event_bus_service'
import { darkEnabled } from '../services/theme_service'
import { createChart } from '../helpers/uplot_adapter'
import { createRanger } from '../helpers/uplot_ranger'
import { getDefinition } from '../charts/registry'
import '../charts/definitions/index' // side-effect: register all definitions

// Below-chart chrome that must stay above the fold: the ranger strip (~86px) plus the
// Time/Blocks axis row (~46px). Both are fixed-height bands (independent of viewport width),
// so a constant is exact enough; the chart's measured top offset absorbs the variable
// controls height (1 vs 2 rows).
const BELOW_CHART_RESERVE = 140
// Readability floor — below this the chart stops shrinking and the page scrolls instead.
const CHART_MIN_HEIGHT = 320

// Trailing debounce so a window drag-resize coalesces into one setSize.
function debounce(fn, ms) {
  let t = null
  return (...args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export default class extends Controller {
  static get targets() {
    return [
      'chartWrapper',
      'labels',
      'chartsView',
      'chartSelect',
      'zoomSelector',
      'zoomOption',
      'scaleType',
      'axisOption',
      'binSelector',
      'scaleSelector',
      'ticketsPurchase',
      'ticketsPrice',
      'hashrateRate',
      'hashrateMiners',
      'vSelectorItem',
      'vSelector',
      'binSize',
      'legendEntry',
      'legendMarker',
      'modeSelector',
      'modeOption',
      'intervalSelector',
      'intervalOption',
      'rawDataURL',
      'rangerView'
    ]
  }

  async connect() {
    this.query = new TurboQuery()
    this.tps = parseInt(this.data.get('tps'))
    this.windowSize = parseInt(this.data.get('windowSize'))
    this.avgBlockTime = parseInt(this.data.get('blockTime')) * 1000

    this.settings = TurboQuery.nullTemplate([
      'chart',
      'zoom',
      'scale',
      'bin',
      'axis',
      'visibility',
      'interval'
    ])
    this.settings.mode = this.data.get('mode')
    this.query.update(this.settings)
    this.settings.chart = this.settings.chart || 'ticket-price'

    this.handle = null
    this.currentDef = null
    this.payload = null
    this.selectedChartName = null
    this.zoomGuard = false
    this.ranger = null

    // Legend element generators (cloned from the template nodes).
    this.legendElement = this.labelsTarget
    const lm = this.legendMarkerTarget
    lm.remove()
    lm.removeAttribute('data-charts-target')
    this.legendMarker = () => {
      const node = document.createElement('div')
      node.appendChild(lm.cloneNode())
      return node.innerHTML
    }
    const le = this.legendEntryTarget
    le.remove()
    le.removeAttribute('data-charts-target')
    this.legendEntry = (s) => {
      const node = le.cloneNode()
      node.innerHTML = s
      return node
    }

    this.processNightMode = () => this.redrawTheme()
    globalEventBus.on('NIGHT_MODE', this.processNightMode)

    this.onWindowResize = debounce(() => this.resizeChartToViewport(), 150)
    window.addEventListener('resize', this.onWindowResize)

    this.chartSelectTarget.value = this.settings.chart

    // Restore the control bar's active state from the persisted URL so a bookmark
    // (e.g. ?bin=block&axis=height&scale=log&zoom=month&mode=stepped&interval=day)
    // drives the same controls the legacy controller restored on load.
    if (this.settings.zoom) this.setActiveOptionBtn(this.settings.zoom, this.zoomOptionTargets)
    if (this.settings.scale) this.setActiveOptionBtn(this.settings.scale, this.scaleTypeTargets)
    if (this.settings.bin) this.setActiveOptionBtn(this.settings.bin, this.binSizeTargets)
    if (this.settings.axis) this.setActiveOptionBtn(this.settings.axis, this.axisOptionTargets)
    if (this.settings.mode) this.setActiveOptionBtn(this.settings.mode, this.modeOptionTargets)
    if (this.settings.interval) {
      this.setActiveOptionBtn(this.settings.interval, this.intervalOptionTargets)
    }
    await this.selectChart()
  }

  disconnect() {
    window.removeEventListener('resize', this.onWindowResize)
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    if (this.handle) {
      this.handle.destroy()
      this.handle = null
    }
    if (this.ranger) {
      this.ranger.destroy()
      this.ranger = null
    }
  }

  // Called by the adapter on a user-driven main-chart x-range change (drag-zoom or
  // double-click reset). Persist with preset-snapping (existing behavior) and reflect the
  // new window in the overview strip.
  onChartRangeChange(min, max) {
    this.persistRange(min, max, true)
    if (this.ranger) this.ranger.setSelection(min, max)
  }

  // Called by the overview strip on a grip/body/native-paint drag. Drive the main chart
  // (silent — setXRange does not re-fire onChartRangeChange) and persist as a CUSTOM range
  // that clears every preset (snap=false). The strip already shows the new selection.
  onRangerSelect(min, max) {
    if (!this.handle) return
    this.handle.setXRange(min, max)
    this.persistRange(min, max, false)
  }

  // Push an x-range to the main chart and mirror it onto the strip. Used by the
  // programmatic zoom paths (applyZoom / presets / privacy default).
  setMainXRange(min, max) {
    if (!this.handle) return
    this.handle.setXRange(min, max)
    if (this.ranger) this.ranger.setSelection(min, max)
  }

  // Persist a visible [min,max] window to the URL + ZOOM control. When snap is true, a
  // window that lines up with a preset re-highlights it; when false (strip drags), always
  // store an encoded custom range and clear every preset.
  persistRange(min, max, snap) {
    if (!this.handle || !this.payload) return
    const xs = this.handle.uplot.data[0]
    if (!xs || !xs.length) return
    const preset = snap ? this.presetForRange(min, max, xs[0], xs[xs.length - 1]) : null
    if (preset) {
      this.settings.zoom = preset
      this.setActiveOptionBtn(preset, this.zoomOptionTargets)
    } else {
      this.settings.zoom = this.encodeRange(min, max)
      this.setActiveOptionBtn(null, this.zoomOptionTargets)
    }
    this.query.replace(this.settings)
  }

  // Map a visible [min,max] window back to a ZOOM preset key, or null for a custom
  // range. Presets are trailing windows ending at the latest datum, so a match needs
  // both the right span and an end at dataMax. Full extent maps to 'all'. Reuses
  // zoomSpan so the comparison works in plot units for both time and height axes.
  presetForRange(min, max, dataMin, dataMax) {
    const fullSpan = dataMax - dataMin
    if (!(fullSpan > 0)) return 'all'
    const tol = fullSpan * 0.005 // 0.5% slack for pixel-rounded drag edges
    if (Math.abs(min - dataMin) <= tol && Math.abs(max - dataMax) <= tol) return 'all'
    if (Math.abs(max - dataMax) <= tol) {
      for (const key of ['day', 'week', 'month', 'year']) {
        const span = this.zoomSpan(key)
        if (span != null && Math.abs(max - min - span) <= tol) return key
      }
    }
    return null
  }

  // Encode a visible x-range into the persisted zoom string. Base-36, and in ms for
  // time charts (plot x is seconds) so the format matches legacy ?zoom=<start>-<end>
  // bookmarks. min/max are in plot x-units.
  encodeRange(min, max) {
    const toMs = this.settings.axis === 'time' ? 1000 : 1
    return Zoom.encode(Math.round(min * toMs), Math.round(max * toMs))
  }

  // Decode a persisted zoom string back into plot x-units, or null if it isn't a range.
  decodeRange(encoded) {
    const z = Zoom.decode(encoded)
    if (!z || typeof z !== 'object' || z.start == null || z.end == null) return null
    const fromMs = this.settings.axis === 'time' ? 1000 : 1
    return { min: z.start / fromMs, max: z.end / fromMs }
  }

  async selectChart() {
    const selection = (this.settings.chart = this.chartSelectTarget.value)
    if (selection === 'hashrate-shares') {
      Turbolinks.visit('/hashrate-shares')
      return
    }

    const def = getDefinition(selection)
    if (!def) {
      console.warn(`selectChart: unknown chart "${selection}"`)
      return
    }

    this.chartWrapperTarget.classList.add('loading')
    this.applyControlVisibility(def, selection)

    const axisChanged = this.settings.axis !== this.selectedAxis()
    const binChanged = this.settings.bin !== this.selectedBin()
    const needFetch =
      this.selectedChartName !== selection || binChanged || axisChanged || !this.payload

    if (needFetch) {
      const url = this.buildURL(def, selection)
      this.payload = await requestJSON(url)
      this.selectedChartName = selection
    }
    await this.renderChart(def)
    const base = `${this.query.url.protocol}//${this.query.url.host}`
    this.rawDataURLTarget.textContent = `${base}/api/chart/${selection}?axis=${this.settings.axis}&bin=${this.settings.bin}&interval=${this.settings.interval}`
    this.query.replace(this.settings)
    this.chartWrapperTarget.classList.remove('loading')
  }

  buildURL(def, selection) {
    // Window-unit charts force bin=window (unless hybrid); others use the selected bin.
    if (def.controls.windowUnits && !def.controls.hybrid) {
      this.settings.bin = 'window'
    } else {
      this.settings.bin = this.selectedBin() || 'block'
    }
    this.settings.axis = this.selectedAxis() || 'time'
    if (!this.settings.interval) this.settings.interval = 'week'
    return (
      `/api/chart/${selection}` +
      `?bin=${this.settings.bin}&axis=${this.settings.axis}&interval=${this.settings.interval}`
    )
  }

  async renderChart(def) {
    // hashrate w/o active_miners → drop the y2 miners series/axis.
    const renderDef = this.resolveRenderDef(def)
    this.currentDef = renderDef

    const cols = renderDef.toColumns(this.payload, this.settingsForDef())
    const xTime = this.settings.axis === 'time'

    if (
      !this.handle ||
      this.renderedName !== renderDef.name ||
      this.renderedXTime !== xTime ||
      this.renderedSeriesCount !== renderDef.series.length
    ) {
      if (this.handle) this.handle.destroy()
      // create synchronously-awaited handle
      this.pendingCreate = createChart(this.chartsViewTarget, renderDef, {
        dark: darkEnabled(),
        width: this.chartsViewTarget.clientWidth || 800,
        height: this.computeChartHeight(),
        scaleType: this.settings.scale === 'log' ? 'log' : 'linear',
        xTime: xTime,
        hooks: this.buildHooks(),
        onRangeChange: (min, max) => this.onChartRangeChange(min, max)
      }).then(async (h) => {
        this.handle = h
        this.renderedName = renderDef.name
        this.renderedXTime = xTime
        this.renderedSeriesCount = renderDef.series.length
        h.setData(cols)
        if (this.settings.mode === 'stepped') h.setMode('stepped')
        await this.recreateRanger(renderDef, cols, xTime)
        this.applyZoom()
        this.setVisibilityFromSettings()
        return h
      })
      return this.pendingCreate
    }
    this.handle.setData(cols)
    if (this.ranger) this.ranger.setData([cols[0], cols[1]])
    this.applyZoom()
  }

  // (Re)build the overview strip for the current chart. The strip always shows the full
  // extent of the primary series; it is recreated whenever the main chart is, so its
  // primary color and x-axis type stay in step.
  async recreateRanger(renderDef, cols, xTime) {
    if (this.ranger) {
      this.ranger.destroy()
      this.ranger = null
    }
    if (!this.hasRangerViewTarget) return
    const g = (this.handle && this.measureGutters(this.handle.uplot)) || { left: 0, right: 0 }
    this.ranger = await createRanger(this.rangerViewTarget, renderDef, {
      dark: darkEnabled(),
      width: this.rangerViewTarget.clientWidth || this.chartsViewTarget.clientWidth || 800,
      xTime: xTime,
      leftGutter: g.left,
      rightGutter: g.right,
      onSelect: (min, max) => this.onRangerSelect(min, max)
    })
    this.ranger.setData([cols[0], cols[1]])
  }

  // chainwork/hashrate set a dynamic axis label; hashrate may drop its y2 series.
  resolveRenderDef(def) {
    let d = def
    if (typeof def.axisLabel === 'function' && this.payload) {
      d = {
        ...d,
        axes: d.axes.map((a, i) => (i === 0 ? { ...a, label: def.axisLabel(this.payload) } : a))
      }
    }
    if (
      def.name === 'hashrate' &&
      !(this.payload && this.payload.active_miners && this.payload.active_miners.length)
    ) {
      d = { ...d, axes: [d.axes[0]], series: [d.series[0]] }
    }
    return d
  }

  settingsForDef() {
    return { tps: this.tps, windowSize: this.windowSize }
  }

  // The chart's height = the viewport minus its top offset (which already includes the
  // controls, however tall they wrapped) minus the fixed below-chart chrome, floored for
  // readability. Used at chart creation and by the window-resize hook.
  computeChartHeight() {
    const top = this.chartsViewTarget.getBoundingClientRect().top
    const avail = window.innerHeight - top - BELOW_CHART_RESERVE
    return Math.max(CHART_MIN_HEIGHT, Math.round(avail))
  }

  // Re-fit the chart to the viewport after a window resize. Reads the live container width
  // and the computed available height and pushes both to uPlot via the existing resize().
  // The draw hook then re-aligns the ranger.
  resizeChartToViewport() {
    if (!this.handle) return
    const width = this.chartsViewTarget.clientWidth || 800
    this.handle.resize(width, this.computeChartHeight())
  }

  buildHooks() {
    return {
      // Create the on-plot hover tooltip once the chart is in the DOM.
      ready: [(u) => this.installTooltip(u)],
      setCursor: [(u) => this.renderLegend(u)],
      // On every main-chart draw, mirror its plot-box insets onto the strip so the two stay
      // aligned through zoom, scale toggle, and single↔dual-axis chart switches.
      draw: [(u) => this.syncRangerGutters(u)]
    }
  }

  // The main chart's plot-box insets in CSS px: the gap between the uPlot root and its
  // over(lay) element on each side. Used to size the strip's reserve axes so its plot area
  // lines up under the main chart's. Returns null if the geometry isn't available yet.
  measureGutters(u) {
    if (!u || !u.over || !u.root) return null
    const root = u.root.getBoundingClientRect()
    const over = u.over.getBoundingClientRect()
    return { left: over.left - root.left, right: root.right - over.right }
  }

  syncRangerGutters(u) {
    if (!this.ranger) return
    const g = this.measureGutters(u)
    if (g) this.ranger.setGutters(g.left, g.right)
  }

  // Create the hover tooltip inside the plot overlay (follows uPlot demos/tooltips.html):
  // a div appended to u.over, shown on cursor-enter and hidden on cursor-leave (kept up
  // during a locked drag). renderLegend fills + positions it. Reassigns this.legendElement
  // so the existing legend content path renders into the on-plot tooltip instead of the
  // hidden seed holder.
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

  // Place the on-plot tooltip near the cursor, flipping the offset to keep the box inside
  // the overlay. No-op for the hidden seed holder (no u.over) so the content-only legend
  // tests stay valid.
  positionTooltip(u) {
    const tt = this.legendElement
    if (!u.over || !tt || !tt.style) return
    const pad = 12
    let left = u.cursor.left + pad
    let top = u.cursor.top + pad
    if (left + tt.offsetWidth > u.over.clientWidth) left = u.cursor.left - tt.offsetWidth - pad
    if (top + tt.offsetHeight > u.over.clientHeight) top = u.cursor.top - tt.offsetHeight - pad
    tt.style.left = `${Math.max(0, left)}px`
    tt.style.top = `${Math.max(0, top)}px`
  }

  renderLegend(u) {
    const idx = u.cursor.idx
    if (idx == null) {
      this.legendElement.classList.add('d-hide')
      return
    }
    this.legendElement.classList.remove('d-hide')
    this.legendElement.replaceChildren()

    // X label.
    const x = u.data[0][idx]
    const xLabel = this.settings.axis === 'time' ? 'Date' : 'Block Height'
    const xText =
      this.settings.axis === 'time'
        ? humanize.date(x * 1000, false, this.settings.chart !== 'ticket-price')
        : String(x)
    this.legendElement.appendChild(this.legendEntry(`${xLabel}: ${xText}`))

    // One entry per series at the cursor index.
    const def = this.currentDef
    const settings = this.settingsForDef()
    def.series.forEach((s, i) => {
      if (u.series && u.series[i + 1] && u.series[i + 1].show === false) return
      const value = u.data[i + 1][idx]
      const datum = { idx: idx, payload: this.payload, value: value }
      const text = def.formatValue(i, datum, settings)
      this.legendElement.appendChild(this.legendEntry(`${this.legendMarker()} ${s.label}: ${text}`))
    })

    // Optional extra non-series lines (e.g. stake-participation).
    if (typeof def.legendExtra === 'function') {
      def.legendExtra({ idx: idx, payload: this.payload }, settings).forEach((line) => {
        this.legendElement.appendChild(this.legendEntry(`${this.legendMarker()} ${line}`))
      })
    }

    this.positionTooltip(u)
  }

  applyControlVisibility(def, selection) {
    const c = def.controls
    this.toggle(this.scaleSelectorTarget, c.scale)
    this.toggle(this.modeSelectorTarget, c.mode)
    this.toggle(this.intervalSelectorTarget, c.interval)
    // BIN hidden for window-unit charts (unless hybrid).
    this.toggle(this.binSelectorTarget, !(c.windowUnits && !c.hybrid))
    if (c.visibility) {
      this.vSelectorTarget.classList.remove('d-hide')
      this.updateVSelector(selection)
    } else {
      this.vSelectorTarget.classList.add('d-hide')
    }
    if (selection === 'hashrate') {
      this.chartsViewTarget.classList.add('chart-hashrate')
    } else {
      this.chartsViewTarget.classList.remove('chart-hashrate')
    }
  }

  toggle(el, show) {
    if (show) el.classList.remove('d-hide')
    else el.classList.add('d-hide')
  }

  applyZoom() {
    if (!this.handle || !this.payload) return
    const xs = this.handle.uplot.data[0]
    if (!xs || !xs.length) return
    const dataMin = xs[0]
    const dataMax = xs[xs.length - 1]

    // privacy-participation defaults to the start of the record.
    if (
      this.settings.chart === 'privacy-participation' &&
      this.currentDef.limits &&
      !this.settings.zoom
    ) {
      const [start] = this.currentDef.limits(this.payload)
      const startX = this.settings.axis === 'time' ? start / 1000 : start
      this.zoomGuard = true
      this.setMainXRange(startX, dataMax)
      this.zoomGuard = false
      return
    }

    // Arbitrary persisted range (e.g. "mq4z4efo-mq7k6k1g") — restore it directly,
    // clamped to the available data. Falls through to the preset logic if invalid.
    const zoom = this.settings.zoom
    if (zoom && zoom.indexOf('-') !== -1) {
      const r = this.decodeRange(zoom)
      if (r) {
        const lo = Math.max(dataMin, r.min)
        const hi = Math.min(dataMax, r.max)
        if (hi > lo) {
          this.zoomGuard = true
          this.setMainXRange(lo, hi)
          this.zoomGuard = false
          return
        }
      }
    }

    const preset = this.settings.zoom
    let min = dataMin
    const max = dataMax
    const span = this.zoomSpan(preset)
    if (span != null) min = Math.max(dataMin, dataMax - span)
    this.zoomGuard = true
    this.setMainXRange(min, max)
    this.zoomGuard = false
  }

  // Span (in plot x-units) for a preset key, or null for 'all'/unknown.
  zoomSpan(preset) {
    // Zoom.mapValue returns the span in milliseconds (0 for 'all', undefined for unknown).
    const ms = Zoom.mapValue(preset)
    if (!ms) return null // 'all' (0) or unknown preset
    const seconds = ms / 1000
    if (this.settings.axis === 'time') return seconds
    // height axis: convert seconds → blocks via the average block time.
    const blockSeconds = this.avgBlockTime / 1000
    return blockSeconds > 0 ? seconds / blockSeconds : null
  }

  redrawTheme() {
    if (this.handle) this.handle.setData(this.handle.uplot.data) // cheap redraw; colors flow via chart_theme on next rebuild
    if (this.ranger) {
      this.ranger.setDark(darkEnabled())
      // setDark rebuilds the strip's uPlot fresh (no selection); re-apply the selection to
      // the full extent so the rectangle doesn't vanish on a night-mode toggle (matches the
      // main chart, which setData autoscales back to full extent on the same redraw).
      const xs = this.ranger.uplot.data[0]
      if (xs && xs.length) this.ranger.setSelection(xs[0], xs[xs.length - 1])
    }
  }

  async setBin(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.binSizeTargets)
    this.updateVSelector()
    if (!target) return
    this.selectedChartName = null // force fetch
    await this.selectChart()
  }

  setScale(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.scaleTypeTargets)
    if (!target) return
    if (this.handle) this.handle.setScaleType(option === 'log' ? 'log' : 'linear')
    this.settings.scale = option
    this.query.replace(this.settings)
  }

  setMode(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.modeOptionTargets)
    if (!target) return
    if (this.handle) this.handle.setMode(option === 'stepped' ? 'stepped' : 'line')
    this.settings.mode = option
    this.query.replace(this.settings)
  }

  async setIntervalOption(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.intervalOptionTargets)
    if (!target) return
    this.settings.interval = option
    this.selectedChartName = null // force re-fetch
    await this.selectChart()
  }

  async setAxis(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.axisOptionTargets)
    if (!target) return
    this.settings.axis = null
    this.selectedChartName = null // force fetch (x-units change)
    await this.selectChart()
  }

  setZoom(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.zoomOptionTargets)
    if (!target) return
    this.settings.zoom = option
    this.applyZoom()
    this.query.replace(this.settings)
  }

  updateVSelector(chart) {
    if (!chart) chart = this.chartSelectTarget.value
    let showWrapper = false
    this.vSelectorItemTargets.forEach((el) => {
      let show = el.dataset.charts.indexOf(chart) > -1
      if (el.dataset.bin && el.dataset.bin.indexOf(this.selectedBin()) === -1) show = false
      if (show) {
        el.classList.remove('d-hide')
        showWrapper = true
      } else {
        el.classList.add('d-hide')
      }
    })
    this.toggle(this.vSelectorTarget, showWrapper)
    this.setVisibilityFromSettings()
  }

  setVisibilityFromSettings() {
    const vis = this.parsedVisibility()
    switch (this.chartSelectTarget.value) {
      case 'ticket-price':
        this.ticketsPriceTarget.checked = vis[0] ?? true
        this.ticketsPurchaseTarget.checked = vis[1] ?? this.ticketsPurchaseTarget.checked
        this.applyVisibilityToHandle(
          ['Price', 'Tickets Bought'],
          [this.ticketsPriceTarget.checked, this.ticketsPurchaseTarget.checked]
        )
        break
      case 'hashrate':
        this.hashrateRateTarget.checked = vis[0] ?? true
        this.hashrateMinersTarget.checked = vis[1] ?? this.hashrateMinersTarget.checked
        this.applyVisibilityToHandle(
          ['Hashrate', 'Active Miners'],
          [this.hashrateRateTarget.checked, this.hashrateMinersTarget.checked]
        )
        break
      default:
        return
    }
    this.persistVisibility()
  }

  setVisibility(e) {
    switch (this.chartSelectTarget.value) {
      case 'ticket-price':
        if (!this.ticketsPriceTarget.checked && !this.ticketsPurchaseTarget.checked) {
          e.currentTarget.checked = true
          return
        }
        this.applyVisibilityToHandle(
          ['Price', 'Tickets Bought'],
          [this.ticketsPriceTarget.checked, this.ticketsPurchaseTarget.checked]
        )
        break
      case 'hashrate':
        if (!this.hashrateRateTarget.checked && !this.hashrateMinersTarget.checked) {
          e.currentTarget.checked = true
          return
        }
        this.applyVisibilityToHandle(
          ['Hashrate', 'Active Miners'],
          [this.hashrateRateTarget.checked, this.hashrateMinersTarget.checked]
        )
        break
      default:
        return
    }
    this.persistVisibility()
  }

  applyVisibilityToHandle(labels, states) {
    if (!this.handle) return
    const map = {}
    labels.forEach((label, i) => (map[label] = states[i]))
    this.handle.setVisibility(map)
  }

  parsedVisibility() {
    if (!this.settings.visibility) return []
    return this.settings.visibility.split('-').map((s) => s === 'true')
  }

  persistVisibility() {
    const states =
      this.chartSelectTarget.value === 'hashrate'
        ? [this.hashrateRateTarget.checked, this.hashrateMinersTarget.checked]
        : [this.ticketsPriceTarget.checked, this.ticketsPurchaseTarget.checked]
    this.settings.visibility = states.join('-')
    this.query.replace(this.settings)
  }

  setActiveOptionBtn(opt, optTargets) {
    optTargets.forEach((li) => {
      if (li.dataset.option === opt) {
        li.classList.add('active')
      } else {
        li.classList.remove('active')
      }
    })
  }

  selectedZoom() {
    return this.selectedOption(this.zoomOptionTargets)
  }

  selectedBin() {
    return this.selectedOption(this.binSizeTargets)
  }

  selectedScale() {
    return this.selectedOption(this.scaleTypeTargets)
  }

  selectedAxis() {
    return this.selectedOption(this.axisOptionTargets)
  }

  selectedOption(optTargets) {
    let key = false
    optTargets.forEach((el) => {
      if (el.classList.contains('active')) key = el.dataset.option
    })
    return key
  }
}
