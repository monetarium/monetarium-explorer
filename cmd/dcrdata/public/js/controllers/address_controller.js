import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { isEmpty } from 'lodash-es'
import { animationFrame, fadeIn } from '../helpers/animation_helper'
import txInBlock from '../helpers/block_helper'
import { padPoints, sizedBarPlotter } from '../helpers/chart_helper'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { getDefault } from '../helpers/module_helper'
import { renderCoinType, splitSkaAtomsNoTrailing } from '../helpers/ska_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import Zoom from '../helpers/zoom_helper'
import globalEventBus from '../services/event_bus_service'

const blockDuration = 5 * 60000
let Dygraph // lazy loaded on connect

function txTypesFunc(d, binSize) {
  const p = []

  d.time.forEach((n, i) => {
    p.push([new Date(n), d.sentRtx[i], d.receivedRtx[i], d.tickets[i], d.votes[i], d.revokeTx[i]])
  })

  padPoints(p, binSize)

  return p
}

function amountFlowProcessor(d, binSize, coinType, atomsByTime) {
  const flowData = []
  const balanceData = []
  atomsByTime.clear()
  const isVAR = coinType === 0

  d.time.forEach((n, i) => {
    const time = new Date(n)
    if (isVAR) {
      const v = d.net[i]
      let netReceived = 0
      let netSent = 0
      v > 0 ? (netReceived = v) : (netSent = v * -1)
      flowData.push([time, d.received[i], d.sent[i], netReceived, netSent])
      // Server precomputes the cumulative VAR balance per bin (`*big.Int`
      // accumulator at db/dcrpg/queries.go); reading it here removes the
      // JS-side Number accumulator that lost precision at high balances.
      balanceData.push([time, d.balance[i]])
    } else {
      const receivedStr = (d.received_atoms && d.received_atoms[i]) || '0'
      const sentStr = (d.sent_atoms && d.sent_atoms[i]) || '0'
      const netStr = (d.net_atoms && d.net_atoms[i]) || '0'
      const balStr = (d.balance_atoms && d.balance_atoms[i]) || '0'
      // Sign split happens on the string — no BigInt arithmetic.
      const isNeg = netStr.charAt(0) === '-'
      const netReceivedStr = isNeg ? '0' : netStr
      const netSentStr = isNeg ? netStr.slice(1) : '0'
      // Number() conversion is lossy at 18 decimals but acceptable for
      // pixel positioning. Legend reads the original atom strings below.
      flowData.push([
        time,
        Number(receivedStr),
        Number(sentStr),
        Number(netReceivedStr),
        Number(netSentStr)
      ])
      balanceData.push([time, Number(balStr)])
      atomsByTime.set(time.getTime(), {
        Received: receivedStr,
        Spent: sentStr,
        'Net Received': netReceivedStr,
        'Net Spent': netSentStr,
        Balance: balStr
      })
    }
  })

  padPoints(flowData, binSize)
  padPoints(balanceData, binSize, true)

  return {
    flow: flowData,
    balance: balanceData
  }
}

function formatter(data) {
  let xHTML = ''
  if (data.xHTML !== undefined) {
    xHTML = humanize.date(data.x, false, true)
  }
  let html = `${this.getLabels()[0]}: ${xHTML}`
  data.series.forEach((series) => {
    if (series.color === undefined) return
    // Skip display of zeros
    if (series.y === 0) return
    const l = `<span style="color: ${series.color};"> ${series.labelHTML}`
    html = `<span style="color:#2d2d2d;">${html}</span>`
    html += `<br>${series.dashHTML}${l}: ${isNaN(series.y) ? '' : series.y}</span>`
  })
  return html
}

function formatSkaAtoms(atomStr) {
  const parts = splitSkaAtomsNoTrailing(atomStr)
  let frac = `${parts.bold}${parts.rest}`
  // Drop trailing zeros from the bold prefix only when rest is empty so the
  // legend never shows a stray ".00" tail.
  if (parts.rest === '') frac = frac.replace(/0+$/, '')
  return frac.length === 0 ? parts.intPart : `${parts.intPart}.${frac}`
}

function makeAmountFormatter(coinType, atomsByTime) {
  const isVAR = coinType === 0
  const coinLabel = renderCoinType(coinType)
  return function (data) {
    let xHTML = ''
    if (data.xHTML !== undefined) {
      xHTML = humanize.date(data.x, false, true)
    }
    let html = `${this.getLabels()[0]}: ${xHTML}`
    const atoms = isVAR ? null : atomsByTime.get(data.x)
    data.series.forEach((series) => {
      if (series.color === undefined) return
      if (series.y === 0) return
      const l = `<span style="color: ${series.color};"> ${series.labelHTML}`
      html = `<span style="color:#2d2d2d;">${html}</span>`
      let valueStr = ''
      if (isVAR) {
        valueStr = isNaN(series.y) ? '' : `${series.y} ${coinLabel}`
      } else {
        const atomStr = atoms ? atoms[series.labelHTML] : null
        if (atomStr) {
          valueStr = `${formatSkaAtoms(atomStr)} ${coinLabel}`
        } else if (!isNaN(series.y)) {
          // Fall back for padPoints synthetic boundary points (no atoms map entry).
          valueStr = `${series.y} ${coinLabel}`
        }
      }
      html += `<br>${series.dashHTML}${l}: ${valueStr}</span> `
    })
    return html
  }
}

function setTxnCountText(el, count) {
  if (el.dataset.formatted) {
    el.textContent = `${count} transaction${count > 1 ? 's' : ''}`
  } else {
    el.textContent = count
  }
}

let commonOptions, typesGraphOptions, amountFlowGraphOptions, balanceGraphOptions
// Cannot set these until DyGraph is fetched.
function createOptions() {
  commonOptions = {
    axes: { y: { axisLabelWidth: 70 } },
    digitsAfterDecimal: 8,
    showRangeSelector: true,
    rangeSelectorHeight: 20,
    rangeSelectorForegroundStrokeColor: '#999',
    rangeSelectorBackgroundStrokeColor: '#777',
    legend: 'follow',
    fillAlpha: 0.9,
    labelsKMB: true,
    labelsUTC: true,
    stepPlot: false,
    rangeSelectorPlotFillColor: 'rgba(128, 128, 128, 0.3)',
    rangeSelectorPlotFillGradientColor: 'transparent',
    rangeSelectorPlotStrokeColor: 'rgba(128, 128, 128, 0.7)',
    rangeSelectorPlotLineWidth: 2
  }

  typesGraphOptions = {
    labels: ['Date', 'Sending (regular)', 'Receiving (regular)', 'Tickets', 'Votes', 'Revocations'],
    colors: ['#69D3F5', '#2971FF', '#41BF53', 'darkorange', '#FF0090'],
    visibility: [true, true, true, true, true],
    legendFormatter: formatter,
    stackedGraph: true,
    fillGraph: false
  }

  // ylabel and legendFormatter are coin-dependent; built per-fetch in popChartCache.
  amountFlowGraphOptions = {
    labels: ['Date', 'Received', 'Spent', 'Net Received', 'Net Spent'],
    colors: ['#2971FF', '#2ED6A1', '#41BF53', '#FF0090'],
    visibility: [true, false, false, false],
    stackedGraph: true,
    fillGraph: false
  }

  balanceGraphOptions = {
    labels: ['Date', 'Balance'],
    colors: ['#41BF53'],
    plotter: [Dygraph.Plotters.linePlotter, Dygraph.Plotters.fillPlotter],
    stackedGraph: false,
    visibility: [true],
    fillGraph: true,
    stepPlot: true
  }
}

// Map an amount-flow bitmap to a Dygraph visibility object.
// Flow bits: 1 = Received, 2 = Sent, 4 = Net. The amountflow chart has four
// series — Dygraph indices 0 received, 1 sent, 2 & 3 net — so the single Net
// bit drives both net series. Values are real booleans: Dygraph's object-form
// setVisibility assigns them verbatim, and other range-selector code paths
// expect booleans, not raw bitmask numbers.
export function flowVisibility(bitmap) {
  return {
    0: (bitmap & 1) !== 0,
    1: (bitmap & 2) !== 0,
    2: (bitmap & 4) !== 0,
    3: (bitmap & 4) !== 0
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
      'coin'
    ]
  }

  async connect() {
    ctrl = this
    ctrl.retrievedData = {}
    ctrl.skaAtomsByTime = new Map()
    ctrl.ajaxing = false
    ctrl.qrCode = false
    ctrl.requestedChart = false
    // Bind functions that are passed as callbacks
    ctrl.zoomCallback = ctrl._zoomCallback.bind(ctrl)
    ctrl.drawCallback = ctrl._drawCallback.bind(ctrl)
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

    Dygraph = await getDefault(
      import(/* webpackChunkName: "dygraphs" */ '../vendor/dygraphs.min.js')
    )

    ctrl.initializeChart()
    ctrl.drawGraph()
  }

  disconnect() {
    if (this.graph !== undefined) {
      this.graph.destroy()
    }
    globalEventBus.off('BLOCK_RECEIVED', this.confirmMempoolTxs)
    this.retrievedData = {}
  }

  // Request the initial chart data, grabbing the Dygraph script if necessary.
  initializeChart() {
    createOptions()
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
      if (this.graph) this.graph.resize()
    }
    this.qriconTarget.classList.add('d-hide')
  }

  async hideQRCode() {
    this.qriconTarget.classList.remove('d-hide')
    this.qrboxTarget.classList.add('d-hide')
    this.qrimgTarget.style.opacity = 0
    await animationFrame()
    if (this.graph) this.graph.resize()
  }

  makeTableUrl(txType, count, offset) {
    const root =
      `addresstable/${this.dcrAddress}`
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

  createGraph(processedData, otherOptions) {
    return new Dygraph(this.chartTarget, processedData, { ...commonOptions, ...otherOptions })
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
    let url = `/api/address/${ctrl.dcrAddress}/${chartKey}/${bin}?coin=${coin}`

    const graphDataResponse = await requestJSON(url)
    ctrl.processData(chart, bin, graphDataResponse)
    ctrl.ajaxing = false
    ctrl.chartLoaderTarget.classList.remove('loading')
  }

  processData(chart, bin, data) {
    if (isEmpty(data)) {
      ctrl.noDataAvailable()
      return
    }

    const coin = ctrl.effectiveCoin()
    const binSize = Zoom.mapValue(bin) || blockDuration
    if (chart === 'types') {
      ctrl.retrievedData[`types-${bin}-${coin}`] = txTypesFunc(data, binSize)
    } else if (chart === 'amountflow' || chart === 'balance') {
      const processed = amountFlowProcessor(data, binSize, coin, ctrl.skaAtomsByTime)
      ctrl.retrievedData[`amountflow-${bin}-${coin}`] = processed.flow
      ctrl.retrievedData[`balance-${bin}-${coin}`] = processed.balance
    } else return
    setTimeout(() => {
      ctrl.popChartCache(chart, bin)
    }, 0)
  }

  popChartCache(chart, bin) {
    const coin = ctrl.effectiveCoin()
    const cacheKey = `${chart}-${bin}-${coin}`
    const binSize = Zoom.mapValue(bin) || blockDuration
    if (!ctrl.retrievedData[cacheKey] || ctrl.requestedChart !== cacheKey) {
      return
    }
    const data = ctrl.retrievedData[cacheKey]
    let options = null
    const coinLabel = renderCoinType(coin)
    const amountFormatter = makeAmountFormatter(coin, ctrl.skaAtomsByTime)
    ctrl.flowTarget.classList.add('d-hide')
    let title = ''
    switch (chart) {
      case 'types':
        options = {
          ...typesGraphOptions,
          legendFormatter: formatter,
          plotter: sizedBarPlotter(binSize)
        }
        title = 'Tx Count'
        break

      case 'amountflow':
        options = {
          ...amountFlowGraphOptions,
          legendFormatter: amountFormatter,
          plotter: sizedBarPlotter(binSize)
        }
        title = `Total (${coinLabel})`
        ctrl.flowTarget.classList.remove('d-hide')
        break

      case 'balance':
        options = {
          ...balanceGraphOptions,
          legendFormatter: amountFormatter
        }
        title = `Balance (${coinLabel})`
        break
    }
    if (ctrl.hasChartTitleTarget) ctrl.chartTitleTarget.textContent = title
    options.zoomCallback = null
    options.drawCallback = null
    if (ctrl.graph === undefined) {
      ctrl.graph = ctrl.createGraph(data, options)
    } else {
      ctrl.graph.updateOptions({
        ...{ file: data },
        ...options
      })
    }
    if (chart === 'amountflow') {
      ctrl.updateFlow()
    }
    ctrl.chartLoaderTarget.classList.remove('loading')
    ctrl.xRange = ctrl.graph.xAxisExtremes()
    ctrl.validateZoom(binSize)
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
    ctrl.setButtonVisibility()
    const zoom = Zoom.validate(ctrl.activeZoomKey || ctrl.settings.zoom, ctrl.xRange, binSize)
    ctrl.setZoom(zoom.start, zoom.end)
    ctrl.graph.updateOptions({
      zoomCallback: ctrl.zoomCallback,
      drawCallback: ctrl.drawCallback
    })
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
    // Apply the whole visibility map in a single setVisibility call. Dygraph
    // runs predraw_ on every setVisibility, so toggling indices one at a time
    // can leave the chart transiently with zero visible series, which crashes
    // the range selector (computeCombinedSeriesAndLimits_ dereferences an
    // empty array). The object form applies all indices, then redraws once;
    // bitmap is non-zero here, so at least one series is always visible.
    this.graph.setVisibility(flowVisibility(bitmap))
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
    if (ctrl.graph === undefined) {
      return
    }
    const duration = ctrl.activeZoomDuration

    const end = ctrl.xRange[1]
    const start = duration === 0 ? ctrl.xRange[0] : end - duration
    ctrl.setZoom(start, end)
  }

  setZoom(start, end) {
    ctrl.chartLoaderTarget.classList.add('loading')
    ctrl.graph.updateOptions({
      dateWindow: [start, end]
    })
    ctrl.settings.zoom = Zoom.encode(start, end)
    ctrl.lastEnd = end
    ctrl.query.replace(ctrl.settings)
    ctrl.chartLoaderTarget.classList.remove('loading')
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

  _drawCallback(graph, first) {
    if (first) return
    const [start, end] = ctrl.graph.xAxisRange()
    if (start === end) return
    if (end === this.lastEnd) return // Only handle slide event.
    this.lastEnd = end
    ctrl.settings.zoom = Zoom.encode(start, end)
    ctrl.query.replace(ctrl.settings)
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.graph.xAxisExtremes()))
  }

  _zoomCallback(start, end) {
    ctrl.zoomButtons.forEach((button) => {
      button.classList.remove('btn-selected')
    })
    ctrl.settings.zoom = Zoom.encode(start, end)
    ctrl.query.replace(ctrl.settings)
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.graph.xAxisExtremes()))
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
    if (this.graph) this.graph.resize()
  }

  putChartBack() {
    const btn = this.expandoTarget
    btn.classList.add('monicon-expand')
    btn.classList.remove('monicon-collapse')
    this.littlechartTarget.appendChild(this.chartboxTarget)
    this.fullscreenTarget.classList.add('d-none')
    if (this.graph) this.graph.resize()
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
    return this.xRange[1] - this.xRange[0]
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
