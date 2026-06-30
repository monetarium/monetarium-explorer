/* global Turbo */
import '@hotwired/turbo'
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbo_helper'
import Zoom from '../helpers/zoom_helper'
import { createChartPanel } from '../helpers/chart_panel'
import { getDefinition } from '../charts/registry'
import '../charts/definitions/index' // side-effect: register all definitions

// Below-chart chrome that must stay above the fold: the ranger strip (~50px incl. margin) plus
// the Time/Blocks axis row (~46px). Both are fixed-height bands (independent of viewport width),
// so a constant is exact enough; the chart's measured top offset absorbs the variable
// controls height (1 vs 2 rows).
const BELOW_CHART_RESERVE = 104
// Breathing room kept below the Time/Blocks row, within the viewport, so it isn't flush against
// the fold.
const BELOW_CHART_GAP = 32
// Readability floor — below this the chart stops shrinking and the page scrolls instead.
const CHART_MIN_HEIGHT = 320

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
      'modeSelector',
      'modeOption',
      'intervalSelector',
      'intervalOption',
      'rawDataURL',
      'rangerView'
    ]
  }

  async connect() {
    // Turbo caches the DOM before Stimulus disconnect fires. If the cached snapshot contains
    // stale uPlot canvases, they end up in the live DOM on cache restore, and selectChart()
    // below appends a fresh chart alongside them — accumulating duplicates. Clear both
    // containers here as a recovery. Also subscribe to turbo:before-cache so we can wipe
    // them BEFORE the snapshot is taken (prevention rather than recovery).
    this._clearChartContainers('connect')

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

    this.currentDef = null
    this.payload = null
    this.selectedChartName = null
    // Monotonic selection counter. selectChart() bumps it on entry and captures the
    // value; after each await it bails if a newer selection has superseded it. Prevents
    // a stale fetch from clobbering this.payload.
    this.fetchGeneration = 0

    // One ChartPanel owns the chart + tooltip + touch-scrub + ranger + theme + resize.
    // xTime/scaleType/mode and the x-label are read LIVE because the Time/Blocks axis, the
    // log/stepped controls, and the ticket-price date format all change at runtime; a rebuild
    // (def-reference change, keyed by memoizedDef) then repaints the current state with no flash.
    // measureSize sizes the chart to the viewport. A main-chart drag snaps to a preset; a
    // ranger-strip drag persists a custom range (source distinguishes them in persistRange).
    this.panel = createChartPanel(this.chartsViewTarget, {
      rangerEl: this.hasRangerViewTarget ? this.rangerViewTarget : null,
      xTime: () => this.settings.axis === 'time',
      scaleType: () => (this.settings.scale === 'log' ? 'log' : 'linear'),
      mode: () => (this.settings.mode === 'stepped' ? 'stepped' : 'line'),
      measureSize: () => ({
        width: this.chartsViewTarget.clientWidth || 800,
        height: this.computeChartHeight()
      }),
      formatX: (x) =>
        this.settings.axis === 'time'
          ? `Date: ${humanize.date(x * 1000, false, this.settings.chart !== 'ticket-price')}`
          : `Block Height: ${x}`,
      onRangeChange: (min, max, source) => this.persistRange(min, max, source === 'chart')
    })

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
    this._boundBeforeCache = () => this._clearChartContainers('before-cache')
    document.addEventListener('turbo:before-cache', this._boundBeforeCache)

    await this.selectChart()
  }

  disconnect() {
    if (this._boundBeforeCache) {
      document.removeEventListener('turbo:before-cache', this._boundBeforeCache)
    }
    if (this.panel) {
      this.panel.destroy()
      this.panel = null
    }
  }

  // Strip stale uPlot DOM from the chart/ranger containers. Used both at connect() (recovery
  // from a cached snapshot that already has canvases) and at turbo:before-cache (prevention —
  // fires before Turbo snapshots, so the cached copy stays clean).
  _clearChartContainers(source) {
    if (source !== 'connect') {
      if (this.panel) {
        this.panel.destroy()
        this.panel = null
      }
    }
    const cv = this.chartsViewTarget
    const rv = this.hasRangerViewTarget ? this.rangerViewTarget : null
    const cvCount = cv.childElementCount
    const rvCount = rv ? rv.childElementCount : 0
    cv.innerHTML = ''
    if (rv) rv.innerHTML = ''
    if (cvCount || rvCount) {
      console.debug('charts:cleared', source || 'unknown', cvCount, rvCount)
    }
  }

  // Persist a visible [min,max] window to the URL + ZOOM control. When snap is true (a
  // main-chart drag), a window that lines up with a preset re-highlights it; when false (a
  // ranger-strip drag), always store an encoded custom range and clear every preset.
  persistRange(min, max, snap) {
    if (!this.panel.handle || !this.payload) return
    const xs = this.panel.handle.uplot.data[0]
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
      Turbo.visit('/hashrate-shares')
      return
    }

    const def = getDefinition(selection)
    if (!def) {
      console.warn(`selectChart: unknown chart "${selection}"`)
      return
    }

    // Claim this selection. Any await below re-checks the counter and bails if a newer
    // selectChart() has run in the meantime, so a slow fetch or createChart can't apply
    // its result over the chart the user actually has selected now.
    const gen = ++this.fetchGeneration

    this.chartWrapperTarget.classList.add('loading')
    this.applyControlVisibility(def, selection)

    const axisChanged = this.settings.axis !== this.selectedAxis()
    const binChanged = this.settings.bin !== this.selectedBin()
    const needFetch =
      this.selectedChartName !== selection || binChanged || axisChanged || !this.payload

    if (needFetch) {
      const url = this.buildURL(def, selection)
      const payload = await requestJSON(url)
      if (gen !== this.fetchGeneration) return // superseded mid-fetch; don't clobber payload
      this.payload = payload
      this.selectedChartName = selection
    }
    await this.renderChart(def)
    if (gen !== this.fetchGeneration) return // superseded during createChart
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
    // Snapshot prev memo before memoizedDef() overwrites it, so we can detect a def change.
    const prevMemo = this._memoDef
    const renderDef = this.memoizedDef(def)
    this.currentDef = renderDef

    // Refresh: a new def reference means the ChartPanel will recreate its uPlot
    // (clean DOM). On def-reuse (same chart, new bin/axis/interval), _ensureChart
    // returns early and setData updates in place — the DOM must stay intact.
    if (prevMemo && renderDef !== prevMemo) {
      this.chartsViewTarget.innerHTML = ''
      if (this.hasRangerViewTarget) this.rangerViewTarget.innerHTML = ''
    }
    const settings = this.settingsForDef()
    const cols = renderDef.toColumns(this.payload, settings)
    // Compute the zoom target BEFORE render and pass it as { range } so the panel seeds the chart
    // AND the ranger to it. A post-render panel.setXRange would race render's deferred full-extent
    // ranger seed and lose the zoom (see spec A1).
    const target = this.computeZoomTarget(cols[0])
    await this.panel.render(renderDef, this.payload, settings, target ? { range: target } : {})
    this.setVisibilityFromSettings()
  }

  // resolveRenderDef returns a NEW object every call; ChartPanel rebuilds on a def-REFERENCE
  // change. Memoize by a structural signature so a stable structure returns the same reference
  // (panel does a cheap setData) and a changed one (chart / axis / series-count / dynamic axis
  // label) returns a new reference (rebuild). xTime is in the signature so an axis flip forces
  // the rebuild that re-resolves the panel's xTime/scaleType/formatX.
  memoizedDef(def) {
    const renderDef = this.resolveRenderDef(def)
    const xTime = this.settings.axis === 'time'
    const axisLabel = (renderDef.axes[0] && renderDef.axes[0].label) || ''
    const sig = `${renderDef.name}|${xTime}|${renderDef.series.length}|${axisLabel}`
    if (this._defSig === sig && this._memoDef) return this._memoDef
    this._defSig = sig
    this._memoDef = renderDef
    return renderDef
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
  //
  // Two non-obvious measurements, both proven against a mobile orientation flip:
  //  - Viewport height comes from documentElement.clientHeight, NOT window.innerHeight. During a
  //    landscape->portrait rotation the browser briefly fires `resize` with a bogus, much larger
  //    innerHeight (visualViewport.height is just as wrong); our debounced hook latches onto it and
  //    sizes the chart taller than the screen, where it sticks (no later width change re-fits it).
  //    clientHeight (the layout viewport) stays correct all the way through the rotation.
  //  - `top` adds scrollY so it is the chart's offset from the top of the *document*, not the
  //    viewport (getBoundingClientRect().top is scroll-relative). Without it, a re-fit while the
  //    page is scrolled reads a smaller top and over-computes the height.
  computeChartHeight() {
    const viewportH = document.documentElement.clientHeight
    const top = this.chartsViewTarget.getBoundingClientRect().top + window.scrollY
    const avail = viewportH - top - BELOW_CHART_RESERVE - BELOW_CHART_GAP
    return Math.max(CHART_MIN_HEIGHT, Math.round(avail))
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

  // The visible [min,max] target for the current zoom setting, or null when there is no data.
  // The render path passes it to panel.render({ range }) (race-free vs the deferred ranger
  // seed); the live preset click (setZoom) feeds it to panel.setXRange. `xs` is the plotted x
  // column. Privacy-participation defaults to the start of the record; an encoded range restores
  // clamped to the data; a preset key is a trailing window ending at dataMax; else full extent.
  computeZoomTarget(xs) {
    if (!xs || !xs.length) return null
    const dataMin = xs[0]
    const dataMax = xs[xs.length - 1]

    if (
      this.settings.chart === 'privacy-participation' &&
      this.currentDef.limits &&
      !this.settings.zoom
    ) {
      const [start] = this.currentDef.limits(this.payload)
      const startX = this.settings.axis === 'time' ? start / 1000 : start
      return { min: startX, max: dataMax }
    }

    const zoom = this.settings.zoom
    if (zoom && zoom.indexOf('-') !== -1) {
      const r = this.decodeRange(zoom)
      if (r) {
        const lo = Math.max(dataMin, r.min)
        const hi = Math.min(dataMax, r.max)
        if (hi > lo) return { min: lo, max: hi }
      }
    }

    const span = this.zoomSpan(zoom)
    const min = span != null ? Math.max(dataMin, dataMax - span) : dataMin
    return { min: min, max: dataMax }
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
    if (this.panel.handle) this.panel.handle.setScaleType(option === 'log' ? 'log' : 'linear')
    this.settings.scale = option
    this.query.replace(this.settings)
  }

  setMode(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.modeOptionTargets)
    if (!target) return
    if (this.panel.handle) this.panel.handle.setMode(option === 'stepped' ? 'stepped' : 'line')
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
    // Live preset click: drive the panel directly (no render -> no deferred-seed race).
    const xs = this.panel.handle && this.panel.handle.uplot.data[0]
    const t = this.computeZoomTarget(xs)
    if (t) this.panel.setXRange(t.min, t.max)
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
    if (!this.panel.handle) return
    const map = {}
    labels.forEach((label, i) => (map[label] = states[i]))
    this.panel.handle.setVisibility(map)
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
