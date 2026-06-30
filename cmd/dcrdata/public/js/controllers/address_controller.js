import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { isEmpty } from 'lodash-es'
import { animationFrame, fadeIn } from '../helpers/animation_helper'
import txInBlock from '../helpers/block_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { getDefault } from '../helpers/module_helper'
import { renderCoinType } from '../helpers/ska_helper'
import TurboQuery from '../helpers/turbo_helper'
import Zoom from '../helpers/zoom_helper'
import globalEventBus from '../services/event_bus_service'
import { createChartPanel } from '../helpers/chart_panel'
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

// The histogram toColumns pads a trailing null bucket one bin past the last bar so the main
// chart's last (left-aligned) bar is fully visible. The ranger draws its primary series as a
// LINE, which stops at the last real point and would leave that trailing bin — the latest bar —
// uncovered. Sustain the last real value across the trailing null so the overview line spans
// the full domain and traces the top of the last bar. The main chart must keep the null (a
// sustained value there would draw a phantom duplicate bar), so this is ranger-only. No-op for
// a column with no trailing null (the Balance chart's pad already sustains its last value).
export function rangerColumn(col) {
  if (!col || col.length < 2 || col[col.length - 1] != null) return col
  const out = col.slice()
  let i = out.length - 2
  while (i >= 0 && out[i] == null) i-- // skip interior data gaps
  if (i >= 0) out[out.length - 1] = out[i]
  return out
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
      'rangerView'
    ]
  }

  async connect() {
    ctrl = this
    ctrl.retrievedData = {}
    ctrl.ajaxing = false
    ctrl.qrCode = false
    ctrl.requestedChart = false
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

    // One ChartPanel owns the chart + tooltip + ranger + theme + resize. All address charts
    // are time-indexed (balance/types/amountflow all build x from secondsFromTimes), so xTime
    // is a constant. The ranger overview line sustains the trailing-null histogram bar
    // (rangerColumn) so it spans the full domain. onRangeChange persists a user drag (chart OR
    // ranger) to the URL and re-highlights the matching zoom preset.
    ctrl.panel = createChartPanel(ctrl.chartTarget, {
      xTime: true,
      rangerEl: ctrl.hasRangerViewTarget ? ctrl.rangerViewTarget : null,
      formatX: (x) => `Date: ${humanize.date(x * 1000, false, true)}`,
      rangerData: (cols) => [cols[0], rangerColumn(cols[1])],
      onRangeChange: (min, max) => {
        ctrl.settings.zoom = Zoom.encode(min * 1000, max * 1000)
        ctrl.query.replace(ctrl.settings)
        ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.xExtent))
      }
    })

    ctrl.initializeChart()
    ctrl.drawGraph()
  }

  disconnect() {
    if (this.panel) {
      this.panel.destroy()
      this.panel = null
    }
    globalEventBus.off('BLOCK_RECEIVED', this.confirmMempoolTxs)
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
      this.panel.resize()
    }
    this.qriconTarget.classList.add('d-hide')
  }

  async hideQRCode() {
    this.qriconTarget.classList.remove('d-hide')
    this.qrboxTarget.classList.add('d-hide')
    this.qrimgTarget.style.opacity = 0
    await animationFrame()
    this.panel.resize()
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

  // Render via the panel. A saved zoom is passed as an explicit target range (seconds) so the
  // panel seeds the chart AND ranger to it — render's deferred full-extent seed would otherwise
  // clobber a post-render setZoom. xExtent (ms) is read back from the plotted x column for the
  // zoom-preset math (validateZoom). amount-flow visibility is applied via the escape hatch.
  async renderChart() {
    const def = this.currentDef
    const binSizeMs = Zoom.mapValue(this.settings.bin) || blockDuration
    const settings = { binSize: binSizeMs / 1000 }
    let opts = {}
    const z = this.settings.zoom ? Zoom.decode(this.settings.zoom) : null
    if (z && isFinite(z.start) && isFinite(z.end)) {
      opts = { range: { min: z.start / 1000, max: z.end / 1000 } }
    }
    await this.panel.render(def, this.payload, settings, opts)
    if (def.name === 'amountflow' && this.flowBoxes) {
      this.panel.handle.setVisibility(flowVisibility(this.flow))
    }
    const xs = this.panel.handle && this.panel.handle.uplot.data[0]
    this.xExtent = xs && xs.length ? [xs[0] * 1000, xs[xs.length - 1] * 1000] : [0, 0]
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
    // Zoom.validate returns false (or, for a dashless ?zoom= that isn't a preset key, the bare
    // string itself) on a malformed value; either way zoom.start/zoom.end are undefined. Guard
    // so a crafted URL can't drive setZoom(undefined) -> setXRange(NaN), which blanks the chart
    // and persists a 'NaN-NaN' range. Fall back to the full extent (the 'all' preset).
    if (!zoom || typeof zoom !== 'object' || !isFinite(zoom.start) || !isFinite(zoom.end)) {
      this.setZoom(this.xExtent[0], this.xExtent[1])
      this.setSelectedZoom('all')
      return
    }
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

  updateFlow(e) {
    // Net is a derived (Received − Spent) view, so stacking it on top of Received/Spent
    // double-counts. Enforce Net <-> Sent/Received mutual exclusivity on user toggles. The
    // programmatic call from popChartCache passes no event, so it can't key off a just-clicked
    // box — but the boxes may come from a saved/crafted ?flow= that sets Net alongside
    // Sent/Received, so clamp that state before reading the bitmap (else the stack double-counts).
    if (e && e.target) this.enforceFlowExclusivity(e.target)
    else this.clampFlowExclusivity()
    const bitmap = this.flow
    if (bitmap === 0) {
      // If all boxes are unchecked, just leave the last view
      // in place to prevent chart errors with zero visible datasets.
      return
    }
    this.settings.flow = bitmap
    this.setGraphQuery()
    if (this.panel.handle) this.panel.handle.setVisibility(flowVisibility(bitmap))
  }

  // Net is mutually exclusive with Sent/Received — it would double-count if stacked on
  // them. When the user checks one side, clear the other; unchecking imposes nothing.
  // `changed` is the checkbox just toggled. Setting `.checked` here fires no change event,
  // so updateFlow is not re-entered.
  enforceFlowExclusivity(changed) {
    if (!changed.checked) return
    const NET = '4'
    const clearNet = changed.value !== NET
    this.flowBoxes.forEach((box) => {
      if (clearNet) {
        if (box.value === NET) box.checked = false
      } else if (box.value !== NET) {
        box.checked = false
      }
    })
  }

  // Programmatic counterpart to enforceFlowExclusivity: with no "just toggled" box to key on,
  // resolve a Net + Sent/Received conflict (only reachable from a saved/crafted ?flow=) in
  // Net's favour — clear Sent/Received whenever Net is checked. A bitmap without Net is left
  // untouched. Setting `.checked` here fires no change event, so updateFlow is not re-entered.
  clampFlowExclusivity() {
    const NET = '4'
    let netChecked = false
    this.flowBoxes.forEach((box) => {
      if (box.value === NET && box.checked) netChecked = true
    })
    if (!netChecked) return
    this.flowBoxes.forEach((box) => {
      if (box.value !== NET) box.checked = false
    })
  }

  setFlowChecks() {
    const bitmap = this.settings.flow
    this.flowBoxes.forEach((box) => {
      box.checked = bitmap & parseInt(box.value)
    })
    // A crafted ?flow= can set Net alongside Sent/Received; collapse to Net-only so the
    // restored checkboxes match the (clamped) view the chart will draw.
    this.clampFlowExclusivity()
  }

  onZoom(e) {
    const target = e.srcElement || e.target
    if (target.nodeName !== 'BUTTON') return
    ctrl.zoomButtons.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    target.classList.add('btn-selected')
    if (!ctrl.panel.handle) {
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
    this.panel.setXRange(start / 1000, end / 1000) // drives both chart + ranger
    this.settings.zoom = Zoom.encode(start, end)
    this.lastEnd = end
    this.query.replace(this.settings)
    this.chartLoaderTarget.classList.remove('loading')
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
    const duration = this.chartDuration
    const buttonSets = [this.zoomButtons, this.binputs]
    buttonSets.forEach((buttonSet) => {
      buttonSet.forEach((button) => {
        if (button.dataset.fixed) return
        // Never hide the currently-selected button. It reflects the active zoom/bin, and
        // hiding also deselects it — leaving the control reading as empty. The Group By
        // default is "Month", so switching to a coin with < 1 month of history (e.g. a
        // young SKA coin) would otherwise drop the Month button while the chart is still
        // grouped by month. A selected button stays put regardless of the duration gate.
        if (duration > Zoom.mapValue(button.name) || button.classList.contains('btn-selected')) {
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
    if (!this.hasPendingTarget) return
    this.pendingTargets.forEach((row) => {
      if (!txInBlock(row.dataset.txid, block)) return
      const confirms = row.querySelector('td.addr-tx-confirms')
      if (!confirms) return
      confirms.textContent = '1'
      confirms.dataset.confirmationBlockHeight = block.height
      const timeTd = row.querySelector('td.addr-tx-time')
      if (timeTd) timeTd.textContent = humanize.date(block.time, true)
      const age = row.querySelector('td.addr-tx-age > span')
      if (!age) return
      age.dataset.age = block.time
      age.textContent = humanize.timeSince(block.unixStamp)
      delete row.dataset.addressTarget
      // Increment the displayed tx count
      if (this.hasTxnCountTarget) {
        const count = this.txnCountTarget
        count.dataset.txnCount++
        setTxnCountText(count, count.dataset.txnCount)
      }
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
    })
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
    this.panel.resize()
  }

  putChartBack() {
    const btn = this.expandoTarget
    btn.classList.add('monicon-expand')
    btn.classList.remove('monicon-collapse')
    this.littlechartTarget.appendChild(this.chartboxTarget)
    this.fullscreenTarget.classList.add('d-none')
    this.panel.resize()
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
