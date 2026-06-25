import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import { createChartPanel } from '../helpers/chart_panel'
import humanize from '../helpers/humanize_helper'
import ws from '../services/messagesocket_service'
import { ticketpoolPurchases } from '../charts/definitions/ticketpool_purchases'
import { ticketpoolPrice } from '../charts/definitions/ticketpool_price'
import { timesToEpoch, computeZoomWindow, expandOnlyUnion } from '../helpers/ticketpool_zoom'

function populateOutputs(data) {
  const totalCount = parseInt(
    data.count.reduce((a, n) => {
      return a + n
    }, 0)
  )
  let tableData =
    '<tr><th style="width: 30%;"># of sstxcommitment outputs</th><th>Count</th><th>% Occurrence</th></tr>'
  data.outputs.forEach((n, i) => {
    const count = parseInt(data.count[i])
    tableData += `<tr><td class="pe-2 lh1rem vam nowrap xs-w117 fw-bold">${parseInt(n)}</td>
    <td><span class="hash lh1rem">${count}</span></td>
    <td><span class="hash lh1rem">${((count * 100) / totalCount).toFixed(4)}% </span></td></tr>`
  })
  const tbody = document.createElement('tbody')
  tbody.innerHTML = tableData
  return tbody
}

export default class extends Controller {
  static get targets() {
    return ['zoom', 'bars', 'age', 'wrapper', 'outputs', 'purchasesRanger', 'priceRanger']
  }

  initialize() {
    this.mempool = false
    this.tipHeight = 0
    this.zoom = 'all'
    this.bars = 'all'
    this._purchasesDefCache = {}
  }

  // Memoized per bars value: a stable def reference for the same bars means ChartPanel
  // does a cheap setData; a new bars value yields a new def -> a rebuild (correct paths).
  purchasesDefFor(barMode) {
    if (!this._purchasesDefCache[barMode]) {
      this._purchasesDefCache[barMode] = ticketpoolPurchases(barMode)
    }
    return this._purchasesDefCache[barMode]
  }

  connect() {
    const purchasesBase = this.purchasesDefFor('all')
    this.purchasesPanel = createChartPanel(document.getElementById('tickets-by-purchase-date'), {
      xTime: true,
      rangerEl: this.purchasesRangerTarget,
      formatX: (x) => `Date: ${humanize.date(x * 1000, false, false)}`,
      rangerData: (cols) => [cols[0], cols[3]],
      rangerDef: { ...purchasesBase, series: [{ ...purchasesBase.series[2], colorIndex: 0 }] }
    })
    this.pricePanel = createChartPanel(document.getElementById('tickets-by-purchase-price'), {
      xTime: false,
      rangerEl: this.priceRangerTarget,
      formatX: (x) => `Price: ${x.toLocaleString('en-US', { maximumFractionDigits: 8 })} VAR`,
      rangerData: (cols) => [cols[0], cols[3]],
      rangerDef: { ...ticketpoolPrice, series: [{ ...ticketpoolPrice.series[2], colorIndex: 0 }] }
    })

    this.newblockUnsub = ws.registerEvtHandler('newblock', () => {
      ws.send('getticketpooldata', this.bars)
    })
    ws.registerEvtHandler('getticketpooldataResp', (evt) => {
      if (evt === '') return
      this.processData(JSON.parse(evt))
    })
    this.reconnectUnsub = ws.registerEvtHandler('reconnect', () => {
      ws.send('getticketpooldata', this.bars)
    })

    this.fetchAll()
  }

  async fetchAll() {
    this.wrapperTarget.classList.add('loading')
    const chartsResponse = await requestJSON('/api/ticketpool/charts')
    this.processData(chartsResponse)
    this.wrapperTarget.classList.remove('loading')
  }

  processData(data) {
    if (data.mempool) {
      this.mempool = data.mempool
      this.tipHeight = data.height
    }
    if (data.time_chart) {
      const matchHeight = this.tipHeight === data.height
      const mempool = matchHeight && this.bars === 'all' ? this.mempool : false
      this.renderOrUpdatePurchases(data.time_chart, mempool)
    }
    if (data.price_chart) {
      this.renderOrUpdatePrice(data.price_chart, this.mempool)
    }
    if (data.outputs_chart) {
      while (this.outputsTarget.firstChild) {
        this.outputsTarget.removeChild(this.outputsTarget.firstChild)
      }
      this.outputsTarget.appendChild(populateOutputs(data.outputs_chart))
    }
  }

  // preserveRange is a no-op on the first render (no prior range) and preserves the zoom
  // across every later same-bars update (the live websocket refresh path).
  renderOrUpdatePurchases(timeData, mempool) {
    return this.purchasesPanel.render(
      this.purchasesDefFor(this.bars),
      timeData,
      { mempool },
      {
        preserveRange: true
      }
    )
  }

  renderOrUpdatePrice(priceData, mempool) {
    return this.pricePanel.render(ticketpoolPrice, priceData, { mempool }, { preserveRange: true })
  }

  disconnect() {
    this.newblockUnsub()
    this.reconnectUnsub()
    ws.deregisterEvtHandlers('getticketpooldataResp')
    this.purchasesPanel?.destroy()
    this.pricePanel?.destroy()
  }

  async onZoom(e) {
    const target = e.currentTarget
    this.zoomTargets.forEach((zt) => zt.classList.remove('active'))
    target.classList.add('active')
    this.zoom = target.dataset.option

    const barsOrder = { all: 0, day: 1, wk: 2, mo: 3 }
    const zoomOrder = { day: 1, wk: 2, mo: 3, all: 4 }
    if (barsOrder[this.bars] > zoomOrder[this.zoom]) {
      // Zoom is finer than the current bar aggregation: auto-coarsen the bars and refetch.
      const newBars = zoomOrder[this.zoom] === 1 ? 'day' : 'wk'
      this.bars = newBars
      this.barsTargets.forEach((bt) => bt.classList.remove('active'))
      const activeBar = Array.from(this.barsTargets).find((bt) => bt.dataset.option === newBars)
      if (activeBar) activeBar.classList.add('active')

      this.wrapperTarget.classList.add('loading')
      const response = await requestJSON(`/api/ticketpool/bydate/${this.bars}`)
      // Anchor the zoom window at the blocks far-right: read the CURRENT ranger extent
      // before the rebuild replaces it with the coarse data.
      const anchorXs = this.purchasesPanel.ranger?.uplot.data[0]
      const xs =
        anchorXs && anchorXs.length
          ? anchorXs
          : timesToEpoch(response.time_chart && response.time_chart.time)
      const [lo, hi] = computeZoomWindow(this.zoom, xs)
      await this.purchasesPanel.render(
        this.purchasesDefFor(this.bars),
        response.time_chart,
        {},
        {
          range: { min: lo, max: hi }
        }
      )
      this.wrapperTarget.classList.remove('loading')
      return
    }

    // No refetch: zoom the existing chart. 'all' uses the active chart extent; day/wk/mo
    // anchor at the ranger (blocks) far-right. No render -> a plain setXRange is race-free.
    const chartXs = this.purchasesPanel.handle?.uplot.data[0]
    if (!chartXs) return
    const rangerXs = this.purchasesPanel.ranger?.uplot.data[0]
    const xs = this.zoom === 'all' ? chartXs : rangerXs && rangerXs.length ? rangerXs : chartXs
    const [lo, hi] = computeZoomWindow(this.zoom, xs)
    this.purchasesPanel.setXRange(lo, hi)
  }

  async onBarsChange(e) {
    const target = e.currentTarget
    this.barsTargets.forEach((bt) => bt.classList.remove('active'))
    target.classList.add('active')
    this.bars = target.dataset.option

    this.wrapperTarget.classList.add('loading')
    const response = await requestJSON(`/api/ticketpool/bydate/${this.bars}`)
    const def = this.purchasesDefFor(this.bars) // new bars -> new def -> rebuild

    // Expand-only union: keep the visible viewport, only grow it to include new data.
    // The data extent comes from the RAW response (before the def's period-end point).
    const sx = this.purchasesPanel.handle?.uplot.scales.x
    const prevMin = sx?.min
    const prevMax = sx?.max
    let opts = {}
    if (prevMin != null && prevMax != null && isFinite(prevMin) && isFinite(prevMax)) {
      const epochs = timesToEpoch(response.time_chart && response.time_chart.time)
      const dataMin = epochs.length ? epochs[0] : prevMin
      const dataMax = epochs.length ? epochs[epochs.length - 1] : prevMax
      const [restoreMin, restoreMax] = expandOnlyUnion(prevMin, prevMax, dataMin, dataMax)
      opts = { range: { min: restoreMin, max: restoreMax } }
    }
    await this.purchasesPanel.render(def, response.time_chart, {}, opts)
    this.wrapperTarget.classList.remove('loading')
  }
}
