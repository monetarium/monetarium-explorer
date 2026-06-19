/* global Turbolinks */
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import Zoom from '../helpers/zoom_helper' // eslint-disable-line no-unused-vars
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
    await this.selectChart()
  }

  disconnect() {
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    if (this.handle) {
      this.handle.destroy()
      this.handle = null
    }
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
    this.applyControlVisibility(def, selection) // Task 18 (stub returns early for now)

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
    this.query.replace(this.settings)
    this.chartWrapperTarget.classList.remove('loading')
  }

  buildURL(def, selection) {
    // Window-unit charts force bin=window (unless hybrid); others use the selected bin.
    if (def.controls.windowUnits && !def.controls.hybrid) {
      this.settings.bin = 'window'
    } else {
      this.settings.bin = this.selectedBin() || 'day'
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

    if (!this.handle || this.renderedName !== renderDef.name || this.renderedXTime !== xTime) {
      if (this.handle) this.handle.destroy()
      // create synchronously-awaited handle
      this.pendingCreate = createChart(this.chartsViewTarget, renderDef, {
        dark: darkEnabled(),
        width: this.chartsViewTarget.clientWidth || 800,
        height: this.chartsViewTarget.clientHeight || 400,
        scaleType: this.settings.scale === 'log' ? 'log' : 'linear',
        xTime: xTime,
        hooks: this.buildHooks()
      }).then((h) => {
        this.handle = h
        this.renderedName = renderDef.name
        this.renderedXTime = xTime
        h.setData(cols)
        this.applyZoom()
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

  // Stubs filled by later tasks:
  applyControlVisibility() {}
  applyZoom() {}
  redrawTheme() {}

  async setBin(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.binSizeTargets)
    if (!target) return // Exit if running for the first time.
    this.selectedChartName = null // Force fetch
    await this.selectChart()
  }

  setScale(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.scaleTypeTargets)
    if (!target) return // Exit if running for the first time.
    if (this.handle) {
      this.handle.setScaleType(option === 'log' ? 'log' : 'linear')
    }
    this.settings.scale = option
    this.query.replace(this.settings)
  }

  setMode(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.modeOptionTargets)
    if (!target) return // Exit if running for the first time.
    if (this.handle) {
      this.handle.setMode(option)
    }
    this.settings.mode = option
    this.query.replace(this.settings)
  }

  async setIntervalOption(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.intervalOptionTargets)
    if (!target) return // Exit if running for the first time.
    this.settings.interval = option
    this.selectedChartName = null // Force re-fetch
    await this.selectChart()
  }

  async setAxis(e) {
    const target = e.srcElement || e.target
    const option = target ? target.dataset.option : e
    if (!option) return
    this.setActiveOptionBtn(option, this.axisOptionTargets)
    if (!target) return // Exit if running for the first time.
    this.settings.axis = null
    await this.selectChart()
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
