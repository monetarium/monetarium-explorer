import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { debounce, isEmpty } from 'lodash-es'
import { animationFrame, fadeIn } from '../helpers/animation_helper'
import txInBlock from '../helpers/block_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { getDefault } from '../helpers/module_helper'
import { renderCoinType } from '../helpers/ska_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import Zoom from '../helpers/zoom_helper'
import globalEventBus from '../services/event_bus_service'
import { darkEnabled } from '../services/theme_service'
import { createChart, resolveSeriesColor } from '../helpers/uplot_adapter'
import { createRanger } from '../helpers/uplot_ranger'
import { balanceDef, typesDef, amountflowDef } from '../charts/definitions/address'

const blockDuration = 5 * 60000

function setTxnCountText(el, count) {
  if (el.dataset.formatted) {
    el.textContent = `${count} transaction${count > 1 ? 's' : ''}`
  } else {
    el.textContent = count
  }
}

// Map an amount-flow bitmap to a uPlot label-keyed visibility map. Flow bits:
// 1 = Received, 2 = Sent, 4 = Net. The Net bit drives BOTH net series (the address
// flow control exposes one "Net" checkbox over the two signed net series). The
// adapter's setVisibility is keyed by series label, so keys are labels, not indices.
export function flowVisibility(bitmap) {
  const net = (bitmap & 4) !== 0
  return {
    Received: (bitmap & 1) !== 0,
    Spent: (bitmap & 2) !== 0,
    'Net Received': net,
    'Net Spent': net
  }
}

let ctrl = null

export default class extends Controller {
  static get targets() {
    return [
      'options',
      'addr',
      'flow',
      'zoom',
      'interval',
      'numUnconfirmed',
      'pagesize',
      'txntype',
      'txnCount',
      'qricon',
      'qrimg',
      'qrbox',
      'paginator',
      'pageplus',
      'pageminus',
      'listbox',
      'table',
      'range',
      'chartbox',
      'noconfirms',
      'chart',
      'pagebuttons',
      'pending',
      'hash',
      'matchhash',
      'view',
      'mergedMsg',
      'chartLoader',
      'chartTitle',
      'listLoader',
      'expando',
      'littlechart',
      'bigchart',
      'fullscreen',
      'tablePagination',
      'paginationheader',
      'coinFilter',
      'coin',
      'rangerView',
      'labels',
      'legendEntry',
      'legendMarker'
    ]
  }

  async connect() {
    ctrl = this
    ctrl.retrievedData = {}
    ctrl.ajaxing = false
    ctrl.qrCode = false
    ctrl.requestedChart = false
    ctrl.handle = null
    ctrl.ranger = null
    ctrl.payload = null
    ctrl.currentDef = null
    ctrl.xExtent = [0, 0]
    ctrl.lastEnd = 0
    ctrl.confirmMempoolTxs = ctrl._confirmMempoolTxs.bind(ctrl)
    ctrl.bindElements()
    ctrl.bindEvents()
    ctrl.query = new TurboQuery()

    // These two are templates for query parameter sets.
    // When url query parameters are set, these will also be updated.
    const settings = (ctrl.settings = TurboQuery.nullTemplate([
      'chart',
      'zoom',
      'bin',
      'flow',
      'n',
      'start',
      'txntype',
      'coin'
    ]))

    ctrl.state = Object.assign({}, settings)

    // Parse stimulus data
    const cdata = ctrl.data
    ctrl.dcrAddress = cdata.get('dcraddress')
    ctrl.paginationParams = {
      offset: parseInt(cdata.get('offset')),
      count: parseInt(cdata.get('txnCount'))
    }

    const rawActiveCoins = ctrl.element.getAttribute('data-active-coins') || '[]'
    try {
      ctrl.activeCoins = JSON.parse(rawActiveCoins)
    } catch {
      ctrl.activeCoins = []
    }
    if (!Array.isArray(ctrl.activeCoins)) ctrl.activeCoins = []

    // Get initial view settings from the url
    ctrl.query.update(settings)
    ctrl.normalizeCoinSetting()
    ctrl.setChartType()
    if (settings.flow) ctrl.setFlowChecks()
    if (settings.zoom !== null) {
      ctrl.zoomButtons.forEach((button) => {
        button.classList.remove('btn-selected')
      })
    }
    if (settings.bin == null) {
      settings.bin = ctrl.getBin()
    }
    if (settings.chart == null || !ctrl.validChartType(settings.chart)) {
      settings.chart = ctrl.chartType
    }

    // Legend element generators (cloned from the template seed nodes in the markup).
    if (ctrl.hasLabelsTarget) {
      ctrl.legendElement = ctrl.labelsTarget
    } else {
      ctrl.legendElement = null
    }
    if (ctrl.hasLegendMarkerTarget) {
      const lm = ctrl.legendMarkerTarget
      lm.remove()
      lm.removeAttribute('data-address-target')
      ctrl.legendMarker = (color) => {
        const node = document.createElement('div')
        const marker = lm.cloneNode()
        if (color) marker.style.borderBottomColor = color
        node.appendChild(marker)
        return node.innerHTML
      }
    } else {
      ctrl.legendMarker = (_color) => ''
    }
    if (ctrl.hasLegendEntryTarget) {
      const le = ctrl.legendEntryTarget
      le.remove()
      le.removeAttribute('data-address-target')
      ctrl.legendEntry = (s) => {
        const node = le.cloneNode()
        node.innerHTML = s
        return node
      }
    } else {
      ctrl.legendEntry = (s) => {
        const node = document.createElement('div')
        node.textContent = s
        return node
      }
    }

    // Night-mode + window-resize listeners (cleaned up in disconnect).
    ctrl.processNightMode = () => ctrl.redrawTheme()
    globalEventBus.on('NIGHT_MODE', ctrl.processNightMode)

    ctrl.onWindowResize = debounce(() => ctrl.resizeChart(), 150)
    window.addEventListener('resize', ctrl.onWindowResize)

    ctrl.initializeChart()
    ctrl.drawGraph()
  }

  disconnect() {
    if (this.handle) {
      this.handle.destroy()
      this.handle = null
    }
    if (this.ranger) {
      this.ranger.destroy()
      this.ranger = null
    }
    globalEventBus.off('BLOCK_RECEIVED', this.confirmMempoolTxs)
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    window.removeEventListener('resize', this.onWindowResize)
    this.retrievedData = {}
  }

  // Request the initial chart data.
  initializeChart() {
    // If no chart data has been requested, e.g. when initially on the
    // list tab, then fetch the initial chart data.
    if (!this.requestedChart) {
      this.fetchGraphData(this.chartType, this.getBin())
    }
  }

  bindElements() {
    this.flowBoxes = this.flowTarget.querySelectorAll('input')
    this.zoomButtons = this.zoomTarget.querySelectorAll('button')
    this.binputs = this.intervalTarget.querySelectorAll('button')
  }

  bindEvents() {
    globalEventBus.on('BLOCK_RECEIVED', this.confirmMempoolTxs)
    ctrl.paginatorTargets.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault()
      })
    })
  }

  async showQRCode() {
    this.qrboxTarget.classList.remove('d-hide')
    if (this.qrCode) {
      await fadeIn(this.qrimgTarget)
    } else {
      const QRCode = await getDefault(import(/* webpackChunkName: "qrcode" */ 'qrcode'))
      const qrCodeImg = await QRCode.toDataURL(this.dcrAddress, {
        errorCorrectionLevel: 'H',
        scale: 6,
        margin: 0
      })
      this.qrimgTarget.innerHTML = `<img src="${qrCodeImg}"/>`
      await fadeIn(this.qrimgTarget)
      this.resizeChart()
    }
    this.qriconTarget.classList.add('d-hide')
  }

  async hideQRCode() {
    this.qriconTarget.classList.remove('d-hide')
    this.qrboxTarget.classList.add('d-hide')
    this.qrimgTarget.style.opacity = 0
    await animationFrame()
    this.resizeChart()
  }

  makeTableUrl(txType, count, offset) {
    const root = `addresstable/${this.dcrAddress}`
    return `/${root}?txntype=${txType}&n=${count}&start=${offset}${this.coinUrlSegment()}`
  }

  coinUrlSegment() {
    const coin = this.settings.coin
    return coin === null || coin === undefined || coin === '' ? '' : `&coin=${coin}`
  }

  normalizeCoinSetting() {
    const settings = this.settings
    if (settings.coin !== null && settings.coin !== undefined && settings.coin !== '') {
      const n = parseInt(settings.coin, 10)
      if (!Number.isInteger(n) || !this.activeCoins.includes(n)) {
        settings.coin = null
        this.query.replace(settings)
      } else {
        // Canonicalize string form for downstream URL building.
        settings.coin = String(n)
      }
    }
    if (this.hasCoinFilterTarget) {
      this.coinFilterTarget.value =
        settings.coin === null || settings.coin === undefined ? '' : String(settings.coin)
    }
    // The chart selector is always pinned to a single coin (no "All" option):
    // when settings.coin is unset, show the effective default coin.
    if (this.hasCoinTarget) {
      const effective =
        settings.coin === null || settings.coin === undefined
          ? String(this.effectiveCoin())
          : String(settings.coin)
      if (this.coinTarget.querySelector(`option[value="${effective}"]`)) {
        this.coinTarget.value = effective
      }
    }
  }

  // effectiveCoin returns the integer coin actually used for chart fetches.
  // Mirrors the backend's CoinTypeAll → 0 collapse for chart endpoints.
  effectiveCoin() {
    const raw = this.settings.coin
    if (raw !== null && raw !== undefined && raw !== '') {
      const n = parseInt(raw, 10)
      if (Number.isInteger(n)) return n
    }
    if (Array.isArray(this.activeCoins) && this.activeCoins.length > 0) {
      return this.activeCoins[0]
    }
    return 0
  }

  changePageSize() {
    this.fetchTable(this.txnType, this.pageSize, this.paginationParams.offset)
  }

  changeTxType() {
    this.fetchTable(this.txnType, this.pageSize, 0)
  }

  changeCoin(e) {
    const v = e.target.value
    this.settings.coin = v === '' ? null : v
    // Keep both selectors (chart + table) in sync regardless of which one fired.
    this.normalizeCoinSetting()
    // Pagination loses meaning when scope changes — fetchTable writes
    // settings.start = 0 and runs query.replace, persisting the new coin to URL.
    this.fetchTable(this.txnType, this.pageSize, 0)
    // Invalidate the drawGraph short-circuit so a coin change refetches the chart.
    this.state.coin = '__force_refetch__'
    this.drawGraph()
  }

  nextPage() {
    this.toPage(1)
  }

  prevPage() {
    this.toPage(-1)
  }

  pageNumberLink(e) {
    e.preventDefault()
    const url = e.target.href
    const parser = new URL(url)
    const start = parser.searchParams.get('start')
    const pagesize = parser.searchParams.get('n')
    const txntype = parser.searchParams.get('txntype')
    this.fetchTable(txntype, pagesize, start)
  }

  toPage(direction) {
    const params = ctrl.paginationParams
    const count = ctrl.pageSize
    const txType = ctrl.txnType
    let requestedOffset = params.offset + count * direction
    if (requestedOffset >= params.count) return
    if (requestedOffset < 0) requestedOffset = 0
    ctrl.fetchTable(txType, count, requestedOffset)
  }

  async fetchTable(txType, count, offset) {
    ctrl.listLoaderTarget.classList.add('loading')
    const requestCount = count > 20 ? count : 20
    const tableResponse = await requestJSON(ctrl.makeTableUrl(txType, requestCount, offset))
    ctrl.tableTarget.innerHTML = dompurify.sanitize(tableResponse.html)
    const settings = ctrl.settings
    settings.n = count
    settings.start = offset
    settings.txntype = txType
    ctrl.paginationParams.count = tableResponse.tx_count
    ctrl.query.replace(settings)
    ctrl.paginationParams.offset = offset
    ctrl.paginationParams.pagesize = count
    ctrl.paginationParams.txntype = txType
    ctrl.setPageability()
    if (txType.indexOf('merged') === -1) {
      this.mergedMsgTarget.classList.add('d-hide')
    } else {
      this.mergedMsgTarget.classList.remove('d-hide')
    }
    ctrl.tablePaginationParams = tableResponse.pages
    ctrl.setTablePaginationLinks()
    ctrl.listLoaderTarget.classList.remove('loading')
  }

  setPageability() {
    const params = ctrl.paginationParams
    const rowMax = params.count
    const count = ctrl.pageSize
    if (ctrl.paginationParams.count === 0) {
      ctrl.paginationheaderTarget.classList.add('d-hide')
    } else {
      ctrl.paginationheaderTarget.classList.remove('d-hide')
    }
    if (rowMax > count) {
      ctrl.pagebuttonsTarget.classList.remove('d-hide')
    } else {
      ctrl.pagebuttonsTarget.classList.add('d-hide')
    }
    const setAbility = (el, state) => {
      if (state) {
        el.classList.remove('disabled')
      } else {
        el.classList.add('disabled')
      }
    }
    setAbility(ctrl.pageplusTarget, params.offset + count < rowMax)
    setAbility(ctrl.pageminusTarget, params.offset - count >= 0)
    const suffix = rowMax > 1 ? 's' : ''
    let rangeEnd = params.offset + count
    if (rangeEnd > rowMax) rangeEnd = rowMax
    ctrl.rangeTarget.innerHTML = `showing ${params.offset + 1} &ndash; ${
      rangeEnd
    } of ${rowMax.toLocaleString()} transaction${suffix}`
  }

  setTablePaginationLinks() {
    const tablePagesLink = ctrl.tablePaginationParams
    if (tablePagesLink.length === 0) return ctrl.tablePaginationTarget.classList.add('d-hide')
    ctrl.tablePaginationTarget.classList.remove('d-hide')
    const txCount = parseInt(ctrl.paginationParams.count)
    const offset = parseInt(ctrl.paginationParams.offset)
    const pageSize = parseInt(ctrl.paginationParams.pagesize)
    const txnType = ctrl.paginationParams.txntype
    let links = ''

    const root = `address/${this.dcrAddress}`
    const coinSeg = this.coinUrlSegment()

    if (typeof offset !== 'undefined' && offset > 0) {
      links =
        `<a href="/${root}?start=${offset - pageSize}&n=${pageSize}&txntype=${txnType}${coinSeg}" ` +
        'class="d-inline-block monicon-arrow-left m-1 fz20" data-action="click->address#pageNumberLink"></a>' +
        '\n'
    }

    links += tablePagesLink
      .map((d) => {
        if (!d.link) return `<span>${d.str}</span>`
        return `<a href="${d.link}" class="fs18 pager px-1${d.active ? ' active' : ''}" data-action="click->address#pageNumberLink">${d.str}</a>`
      })
      .join('\n')

    if (txCount - offset > pageSize) {
      links +=
        '\n' +
        `<a href="/${root}?start=${offset + pageSize}&n=${pageSize}&txntype=${txnType}${coinSeg}" ` +
        'class="d-inline-block monicon-arrow-right m-1 fs20" data-action="click->address#pageNumberLink"></a>'
    }

    ctrl.tablePaginationTarget.innerHTML = dompurify.sanitize(links)
  }

  drawGraph() {
    const settings = ctrl.settings

    ctrl.noconfirmsTarget.classList.add('d-hide')
    ctrl.chartTarget.classList.remove('d-hide')

    // Check for invalid view parameters
    if (!ctrl.validChartType(settings.chart) || !ctrl.validGraphInterval()) return

    if (
      settings.chart === ctrl.state.chart &&
      settings.bin === ctrl.state.bin &&
      settings.coin === ctrl.state.coin
    ) {
      // Only the zoom has changed.
      const zoom = Zoom.decode(settings.zoom)
      if (zoom) {
        ctrl.setZoom(zoom.start, zoom.end)
      }
      return
    }

    // Set the current view to prevent unnecessary reloads.
    Object.assign(ctrl.state, settings)
    ctrl.fetchGraphData(settings.chart, settings.bin)
  }

  async fetchGraphData(chart, bin) {
    const coin = ctrl.effectiveCoin()
    const cacheKey = `${chart}-${bin}-${coin}`
    if (ctrl.ajaxing === cacheKey) {
      return
    }
    ctrl.requestedChart = cacheKey
    ctrl.ajaxing = cacheKey

    ctrl.chartLoaderTarget.classList.add('loading')

    // Check for cached data
    if (ctrl.retrievedData[cacheKey]) {
      // Queue the function to allow the loader to display.
      setTimeout(() => {
        ctrl.popChartCache(chart, bin)
        ctrl.chartLoaderTarget.classList.remove('loading')
        ctrl.ajaxing = false
      }, 10) // 0 should work but doesn't always
      return
    }

    const chartKey = chart === 'balance' ? 'amountflow' : chart
    const url = `/api/address/${ctrl.dcrAddress}/${chartKey}/${bin}?coin=${coin}`

    const graphDataResponse = await requestJSON(url)
    ctrl.processData(chart, bin, graphDataResponse)
    ctrl.ajaxing = false
    ctrl.chartLoaderTarget.classList.remove('loading')
  }

  // Store the raw API payload per cache key. amountflow + balance share one
  // endpoint so both chart types key under 'amountflow-<bin>-<coin>'.
  processData(chart, bin, data) {
    if (isEmpty(data)) {
      ctrl.noDataAvailable()
      return
    }
    const coin = ctrl.effectiveCoin()
    const key = chart === 'balance' ? 'amountflow' : chart
    ctrl.retrievedData[`${key}-${bin}-${coin}`] = data
    setTimeout(() => ctrl.popChartCache(chart, bin), 0)
  }

  // Return the definition factory for a chart type + coin combination.
  defFor(chart, coin) {
    if (chart === 'types') return typesDef()
    if (chart === 'balance') return balanceDef(coin)
    return amountflowDef(coin)
  }

  async popChartCache(chart, bin) {
    const coin = ctrl.effectiveCoin()
    const dataKey = `${chart === 'balance' ? 'amountflow' : chart}-${bin}-${coin}`
    if (!ctrl.retrievedData[dataKey] || ctrl.requestedChart !== `${chart}-${bin}-${coin}`) return
    ctrl.payload = ctrl.retrievedData[dataKey]
    ctrl.currentDef = ctrl.defFor(chart, coin)
    const coinLabel = renderCoinType(coin)
    ctrl.flowTarget.classList.add('d-hide')
    if (chart === 'amountflow') ctrl.flowTarget.classList.remove('d-hide')
    const titles = {
      types: 'Tx Count',
      amountflow: `Total (${coinLabel})`,
      balance: `Balance (${coinLabel})`
    }
    if (ctrl.hasChartTitleTarget) ctrl.chartTitleTarget.textContent = titles[chart]
    await ctrl.renderChart()
    if (chart === 'amountflow') ctrl.updateFlow()
    ctrl.chartLoaderTarget.classList.remove('loading')
    ctrl.validateZoom(Zoom.mapValue(bin) || blockDuration)
  }

  // Build chart hooks for the tooltip (ready + setCursor) and ranger alignment (draw).
  buildHooks() {
    return {
      ready: [(u) => this.installTooltip(u)],
      setCursor: [(u) => this.renderLegend(u)],
      // On every main-chart draw, mirror its plot-box insets onto the strip so the two stay
      // aligned through zoom and chart-type/coin switches (ported from charts_controller).
      draw: [(u) => this.syncRangerGutters(u)]
    }
  }

  // The main chart's plot-box insets in CSS px: the gap between the uPlot root and its
  // over(lay) element on each side. Used to size the strip's reserve padding so its plot
  // area lines up under the main chart's (so the ranger spans the same length as the
  // x-axis). Null if the geometry isn't available yet. Ported from charts_controller.
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

  // Create the on-plot hover tooltip inside the uPlot overlay div.
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

  // Position the tooltip near the cursor, flipping when near the edge.
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

  // Render the tooltip content at the current cursor index.
  // Zero-valued series are skipped (parity with the old Dygraphs legendFormatter).
  // For stacked charts, datum.value is the cumulative stack total — NOT the raw
  // per-series value. formatValue reads the raw payload to avoid this.
  renderLegend(u) {
    const idx = u.cursor.idx
    if (!this.legendElement) return
    if (idx == null) {
      this.legendElement.classList.add('d-hide')
      return
    }
    this.legendElement.classList.remove('d-hide')
    this.legendElement.replaceChildren()

    // X label (address charts always use a time axis).
    const x = u.data[0][idx]
    this.legendElement.appendChild(
      this.legendEntry(`Date: ${humanize.date(x * 1000, false, true)}`)
    )

    const def = this.currentDef
    def.series.forEach((s, i) => {
      if (u.series && u.series[i + 1] && u.series[i + 1].show === false) return
      const value = u.data[i + 1][idx]
      if (value == null) return // gap — skip
      const text = def.formatValue(i, { idx: idx, payload: this.payload, value: value }, {})
      // Skip zero-valued series on the stacked amount charts (Tx Type / Sent-Received) so the
      // tooltip isn't cluttered with each bin's many 0 series (parity with the old
      // legendFormatter's `if (series.y === 0) return`). The single-series Balance chart is NOT
      // stacked: a 0 balance is meaningful, so always show it.
      if (def.stacked && /^0(\s|$)/.test(text)) return
      const color = resolveSeriesColor(s, i, darkEnabled())
      this.legendElement.appendChild(
        this.legendEntry(`${this.legendMarker(color)} ${s.label}: ${text}`)
      )
    })

    this.positionTooltip(u)
  }

  // Create or recreate the main uPlot chart. A def swap (chart-type or coin change)
  // requires a full recreate because uPlot fixes series at construction time.
  async renderChart() {
    const def = this.currentDef
    const binSizeMs = Zoom.mapValue(this.settings.bin) || blockDuration
    const cols = def.toColumns(this.payload, { binSize: binSizeMs / 1000 })
    this.xExtent = cols[0].length ? [cols[0][0] * 1000, cols[0][cols[0].length - 1] * 1000] : [0, 0]
    const opts = {
      dark: darkEnabled(),
      width: this.chartTarget.clientWidth || 800,
      height: this.chartTarget.clientHeight || 320,
      xTime: true,
      hooks: this.buildHooks(),
      onRangeChange: (min, max) => this.onChartRangeChange(min, max)
    }
    if (this.handle) this.handle.destroy()
    this.handle = await createChart(this.chartTarget, def, opts)
    this.handle.setData(cols)
    await this.recreateRanger(def, cols)
  }

  noDataAvailable() {
    this.noconfirmsTarget.classList.remove('d-hide')
    this.chartTarget.classList.add('d-hide')
    this.chartLoaderTarget.classList.remove('loading')
  }

  validChartType(chart) {
    return this.optionsTarget.namedItem(chart) || false
  }

  validGraphInterval(interval) {
    const bin = interval || this.settings.bin || this.activeBin
    let b = false
    this.binputs.forEach((button) => {
      if (button.name === bin) b = button
    })
    return b
  }

  validateZoom(binSize) {
    this.setButtonVisibility()
    const zoom = Zoom.validate(this.activeZoomKey || this.settings.zoom, this.xExtent, binSize)
    this.setZoom(zoom.start, zoom.end)
    // setZoom drives the chart + persists an encoded range but selects no button. On load
    // connect() has deselected every zoom button, so without this the control reads as
    // unselected (issue 1). Map the validated window back to a preset key and re-highlight
    // it (null for a custom range → setSelectedZoom clears all, which is correct).
    this.setSelectedZoom(Zoom.mapKey(zoom, this.xExtent))
  }

  changeGraph(_e) {
    this.settings.chart = this.chartType
    this.setGraphQuery()
    this.drawGraph()
  }

  changeBin(e) {
    const target = e.srcElement || e.target
    if (target.nodeName !== 'BUTTON') return
    ctrl.settings.bin = target.name
    ctrl.setIntervalButton(target.name)
    this.setGraphQuery()
    this.drawGraph()
  }

  setGraphQuery() {
    this.query.replace(this.settings)
  }

  updateFlow() {
    const bitmap = this.flow
    if (bitmap === 0) {
      // If all boxes are unchecked, just leave the last view
      // in place to prevent chart errors with zero visible datasets.
      return
    }
    this.settings.flow = bitmap
    this.setGraphQuery()
    if (this.handle) this.handle.setVisibility(flowVisibility(bitmap))
  }

  setFlowChecks() {
    const bitmap = this.settings.flow
    this.flowBoxes.forEach((box) => {
      box.checked = bitmap & parseInt(box.value)
    })
  }

  onZoom(e) {
    const target = e.srcElement || e.target
    if (target.nodeName !== 'BUTTON') return
    ctrl.zoomButtons.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    target.classList.add('btn-selected')
    if (!ctrl.handle) {
      return
    }
    const duration = ctrl.activeZoomDuration
    const end = ctrl.xExtent[1]
    const start = duration === 0 ? ctrl.xExtent[0] : end - duration
    ctrl.setZoom(start, end)
  }

  setZoom(start, end) {
    // start/end are in ms (from xExtent ms and Zoom.mapValue ms).
    // Convert to seconds at the uPlot boundary; keep Zoom.encode in ms.
    this.chartLoaderTarget.classList.add('loading')
    if (this.handle) this.handle.setXRange(start / 1000, end / 1000)
    if (this.ranger) this.ranger.setSelection(start / 1000, end / 1000)
    this.settings.zoom = Zoom.encode(start, end)
    this.lastEnd = end
    this.query.replace(this.settings)
    this.chartLoaderTarget.classList.remove('loading')
  }

  // Called by the adapter on a user-driven main-chart x-range change (drag-zoom).
  // min/max arrive in seconds (uPlot x-scale); encode in ms for Zoom; ranger stays seconds.
  onChartRangeChange(min, max) {
    ctrl.settings.zoom = Zoom.encode(min * 1000, max * 1000)
    ctrl.query.replace(ctrl.settings)
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.xExtent))
    if (ctrl.ranger) ctrl.ranger.setSelection(min, max)
  }

  // Called by the overview strip on a grip/body drag. Drive the main chart (silent).
  // min/max arrive in seconds (ranger posToVal); handle stays seconds; encode zoom in ms.
  onRangerSelect(min, max) {
    if (!this.handle) return
    this.handle.setXRange(min, max)
    this.settings.zoom = Zoom.encode(min * 1000, max * 1000)
    this.query.replace(this.settings)
    this.setSelectedZoom(Zoom.mapKey(this.settings.zoom, this.xExtent))
  }

  // Create or recreate the ranger strip with the primary series data.
  async recreateRanger(def, cols) {
    if (this.ranger) {
      this.ranger.destroy()
      this.ranger = null
    }
    if (!this.hasRangerViewTarget) return
    // Seed the strip's plot insets from the main chart's so it starts aligned; the draw
    // hook (syncRangerGutters) keeps them matched thereafter.
    const g = (this.handle && this.measureGutters(this.handle.uplot)) || { left: 0, right: 0 }
    this.ranger = await createRanger(this.rangerViewTarget, def, {
      dark: darkEnabled(),
      width: this.rangerViewTarget.clientWidth || 800,
      xTime: true,
      leftGutter: g.left,
      rightGutter: g.right,
      onSelect: (min, max) => this.onRangerSelect(min, max)
    })
    this.ranger.setData([cols[0], cols[1]])
    if (this.settings.zoom) {
      const z = Zoom.decode(this.settings.zoom)
      // Zoom.decode returns ms; convert to seconds for the ranger's posToVal scale.
      if (z) this.ranger.setSelection(z.start / 1000, z.end / 1000)
    }
  }

  // Push the current dark/light theme state to the handle and ranger.
  redrawTheme() {
    const dark = darkEnabled()
    // Capture the main chart's visible x-range BEFORE rebuilding — uPlot commits scale values
    // on a microtask, so reading scales.x right after a rebuild yields stale nulls.
    const sx = this.handle && this.handle.uplot.scales.x
    const range = sx && sx.min != null && sx.max != null ? [sx.min, sx.max] : null
    if (this.handle) this.handle.setDark(dark)
    if (this.ranger) {
      this.ranger.setDark(dark)
      // setDark rebuilds the strip fresh (no selection); re-apply it so the rectangle survives
      // the toggle. The rebuild commits its scales/layout on a microtask, so setSelection's
      // valToPos is not ready synchronously — defer to a later microtask (FIFO: uPlot's commit
      // runs first) or the rectangle collapses to zero width. Prefer the captured main-chart
      // range; fall back to the strip's full extent so the rectangle can never vanish.
      queueMicrotask(() => {
        if (!this.ranger) return
        if (range) this.ranger.setSelection(range[0], range[1])
        else {
          const xs = this.ranger.uplot.data[0]
          if (xs && xs.length) this.ranger.setSelection(xs[0], xs[xs.length - 1])
        }
      })
    }
  }

  // Resize the chart and ranger strip after a window resize.
  resizeChart() {
    if (!this.handle) return
    const width = this.chartTarget.clientWidth || 800
    this.handle.resize(width, this.chartTarget.clientHeight || 320)
    if (!this.ranger || !this.hasRangerViewTarget) return
    this.ranger.setWidth(this.rangerViewTarget.clientWidth || width)
    // The strip's selection rectangle is pixel-based, so a width change invalidates it. Re-apply
    // it from the main chart's current x-range, deferred to a microtask so uPlot's own resize
    // commit (which rescales the selection) settles first (mirrors redrawTheme).
    const sx = this.handle.uplot.scales.x
    if (sx && sx.min != null && sx.max != null) {
      const min = sx.min
      const max = sx.max
      queueMicrotask(() => {
        if (this.ranger) this.ranger.setSelection(min, max)
      })
    }
  }

  getBin() {
    let bin = ctrl.query.get('bin')
    if (!ctrl.setIntervalButton(bin)) {
      bin = ctrl.activeBin
    }
    return bin
  }

  setIntervalButton(interval) {
    const button = ctrl.validGraphInterval(interval)
    if (!button) return false
    ctrl.binputs.forEach((btn) => {
      btn.classList.remove('btn-selected')
    })
    button.classList.add('btn-selected')
  }

  setViewButton(view) {
    this.viewTargets.forEach((button) => {
      if (button.name === view) {
        button.classList.add('btn-active')
      } else {
        button.classList.remove('btn-active')
      }
    })
  }

  setChartType() {
    const chart = this.settings.chart
    if (this.validChartType(chart)) {
      this.optionsTarget.value = chart
    }
  }

  setSelectedZoom(zoomKey) {
    this.zoomButtons.forEach((button) => {
      if (button.name === zoomKey) {
        button.classList.add('btn-selected')
      } else {
        button.classList.remove('btn-selected')
      }
    })
  }

  setButtonVisibility() {
    const duration = ctrl.chartDuration
    const buttonSets = [ctrl.zoomButtons, ctrl.binputs]
    buttonSets.forEach((buttonSet) => {
      buttonSet.forEach((button) => {
        if (button.dataset.fixed) return
        if (duration > Zoom.mapValue(button.name)) {
          button.classList.remove('d-hide')
        } else {
          button.classList.remove('btn-selected')
          button.classList.add('d-hide')
        }
      })
    })
  }

  _confirmMempoolTxs(blockData) {
    const block = blockData.block
    if (this.hasPendingTarget) {
      this.pendingTargets.forEach((row) => {
        if (txInBlock(row.dataset.txid, block)) {
          const confirms = row.querySelector('td.addr-tx-confirms')
          confirms.textContent = '1'
          confirms.dataset.confirmationBlockHeight = block.height
          row.querySelector('td.addr-tx-time').textContent = humanize.date(block.time, true)
          const age = row.querySelector('td.addr-tx-age > span')
          age.dataset.age = block.time
          age.textContent = humanize.timeSince(block.unixStamp)
          delete row.dataset.addressTarget
          // Increment the displayed tx count
          const count = this.txnCountTarget
          count.dataset.txnCount++
          setTxnCountText(count, count.dataset.txnCount)
          // Decrement only the unconfirmed counter whose coin matches the
          // confirmed transaction. The coin type comes from the SSR-rendered
          // data-coin-type attribute on the row's Coin column.
          const rowCoinType = row.querySelector('[data-coin-type]')?.dataset.coinType
          this.numUnconfirmedTargets.forEach((tr) => {
            if (rowCoinType !== undefined && tr.dataset.coinType !== rowCoinType) return
            const countSpan = tr.querySelector('.addr-unconfirmed-count')
            let unconfirmedCount = parseInt(tr.dataset.count)
            if (isNaN(unconfirmedCount)) unconfirmedCount = 0
            if (unconfirmedCount > 0) unconfirmedCount--
            tr.dataset.count = unconfirmedCount
            if (unconfirmedCount === 0) {
              tr.classList.add('d-hide')
              delete tr.dataset.addressTarget
            } else if (countSpan) {
              countSpan.textContent = unconfirmedCount.toLocaleString()
            }
          })
        }
      })
    }
  }

  hashOver(e) {
    const target = e.srcElement || e.target
    const href = target.href
    this.hashTargets.forEach((link) => {
      if (link.href === href) {
        link.classList.add('blue-row')
      } else {
        link.classList.remove('blue-row')
      }
    })
  }

  hashOut(_e) {
    const target = _e.srcElement || _e.target
    const href = target.href
    this.hashTargets.forEach((link) => {
      if (link.href === href) {
        link.classList.remove('blue-row')
      }
    })
  }

  toggleExpand(_e) {
    const btn = this.expandoTarget
    if (btn.classList.contains('monicon-expand')) {
      btn.classList.remove('monicon-expand')
      btn.classList.add('monicon-collapse')
      this.bigchartTarget.appendChild(this.chartboxTarget)
      this.fullscreenTarget.classList.remove('d-none')
    } else {
      this.putChartBack()
    }
    this.resizeChart()
  }

  putChartBack() {
    const btn = this.expandoTarget
    btn.classList.add('monicon-expand')
    btn.classList.remove('monicon-collapse')
    this.littlechartTarget.appendChild(this.chartboxTarget)
    this.fullscreenTarget.classList.add('d-none')
    this.resizeChart()
  }

  exitFullscreen(e) {
    if (e.target !== this.fullscreenTarget) return
    this.putChartBack()
  }

  get chartType() {
    return this.optionsTarget.value
  }

  get activeView() {
    let view = null
    this.viewTargets.forEach((button) => {
      if (button.classList.contains('btn-active')) view = button.name
    })
    return view
  }

  get activeZoomDuration() {
    return this.activeZoomKey ? Zoom.mapValue(this.activeZoomKey) : false
  }

  get activeZoomKey() {
    const activeButtons = this.zoomTarget.getElementsByClassName('btn-selected')
    if (activeButtons.length === 0) return null
    return activeButtons[0].name
  }

  get chartDuration() {
    return this.xExtent[1] - this.xExtent[0]
  }

  get activeBin() {
    return this.intervalTarget.getElementsByClassName('btn-selected')[0].name
  }

  get flow() {
    let base10 = 0
    this.flowBoxes.forEach((box) => {
      if (box.checked) base10 += parseInt(box.value)
    })
    return base10
  }

  get txnType() {
    return this.txntypeTarget.selectedOptions[0].value
  }

  get pageSize() {
    const selected = this.pagesizeTarget.selectedOptions
    return selected.length ? parseInt(selected[0].value) : 20
  }
}
