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
import { getDefinition } from '../charts/registry'
import '../charts/definitions/index' // side-effect: register all definitions

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
      'rawDataURL'
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
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    if (this.handle) {
      this.handle.destroy()
      this.handle = null
    }
  }

  // Called by the adapter on a user-driven x-range change (drag-zoom or double-click
  // reset) — never for our own programmatic zooms. Translate the new range into the
  // ZOOM control + URL: snap it to a preset when it lines up with one (so a drag that
  // happens to match a week, or a double-click reset to 'all', re-highlights the right
  // button), otherwise persist the exact window as an encoded range and clear presets.
  onChartRangeChange(min, max) {
    if (!this.handle || !this.payload) return
    const xs = this.handle.uplot.data[0]
    if (!xs || !xs.length) return
    const preset = this.presetForRange(min, max, xs[0], xs[xs.length - 1])
    if (preset) {
      this.settings.zoom = preset
      this.setActiveOptionBtn(preset, this.zoomOptionTargets)
    } else {
      this.settings.zoom = this.encodeRange(min, max)
      this.setActiveOptionBtn(null, this.zoomOptionTargets) // custom range: no preset active
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
        height: this.chartsViewTarget.clientHeight || 400,
        scaleType: this.settings.scale === 'log' ? 'log' : 'linear',
        xTime: xTime,
        hooks: this.buildHooks(),
        onRangeChange: (min, max) => this.onChartRangeChange(min, max)
      }).then((h) => {
        this.handle = h
        this.renderedName = renderDef.name
        this.renderedXTime = xTime
        this.renderedSeriesCount = renderDef.series.length
        h.setData(cols)
        if (this.settings.mode === 'stepped') h.setMode('stepped')
        this.applyZoom()
        this.setVisibilityFromSettings()
        return h
      })
      return this.pendingCreate
    }
    this.handle.setData(cols)
    this.applyZoom()
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

  buildHooks() {
    return { setCursor: [(u) => this.renderLegend(u)] }
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
      this.handle.setXRange(startX, dataMax)
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
          this.handle.setXRange(lo, hi)
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
    this.handle.setXRange(min, max)
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
