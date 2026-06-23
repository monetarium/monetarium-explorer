import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { requestJSON } from '../helpers/http'
import { createChart, resolveSeriesColor } from '../helpers/uplot_adapter'
import { createRanger } from '../helpers/uplot_ranger'
import { darkEnabled } from '../services/theme_service'
import globalEventBus from '../services/event_bus_service'
import humanize from '../helpers/humanize_helper'
import ws from '../services/messagesocket_service'
import { ticketpoolPurchases } from '../charts/definitions/ticketpool_purchases'
import { ticketpoolPrice } from '../charts/definitions/ticketpool_price'

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

function installTooltip(u) {
  const tt = document.createElement('div')
  tt.className = 'chart-tooltip d-hide'
  u.over.appendChild(tt)
  u.over.addEventListener('mouseenter', () => tt.classList.remove('d-hide'))
  u.over.addEventListener('mouseleave', () => tt.classList.add('d-hide'))
  return tt
}

function renderTooltip(u, tt, def) {
  if (!tt || !u.cursor) return
  const idx = u.cursor.idx
  if (idx == null || idx < 0) {
    tt.classList.add('d-hide')
    return
  }
  tt.classList.remove('d-hide')
  tt.replaceChildren()
  const isPrice = def.name === 'ticketpool-price'
  const xVal = u.data[0][idx]
  const xRow = document.createElement('div')
  xRow.style.fontWeight = 'bold'
  if (isPrice) {
    xRow.textContent = `Price: ${xVal.toLocaleString('en-US', { maximumFractionDigits: 8 })} VAR`
  } else {
    xRow.textContent = `Date: ${humanize.date(xVal * 1000, false, false)}`
  }
  tt.appendChild(xRow)
  def.series.forEach((s, i) => {
    if (u.series && u.series[i + 1] && u.series[i + 1].show === false) return
    const value = u.data[i + 1][idx]
    const datum = { idx: idx, payload: null, value: value }
    const text = def.formatValue(i, datum)
    const color = resolveSeriesColor(s, i, darkEnabled())
    const entry = document.createElement('div')
    const label = dompurify.sanitize(s.label)
    const fv = dompurify.sanitize(text)
    entry.innerHTML = `<span style="color:${color};font-weight:bold">●</span> ${label}: ${fv}`
    tt.appendChild(entry)
  })
  const pad = 12
  let left = u.cursor.left + pad
  let top = u.cursor.top + pad
  if (left + tt.offsetWidth > u.over.clientWidth) left = u.cursor.left - tt.offsetWidth - pad
  if (top + tt.offsetHeight > u.over.clientHeight) top = u.cursor.top - tt.offsetHeight - pad
  tt.style.left = `${Math.max(0, left)}px`
  tt.style.top = `${Math.max(0, top)}px`
}

function computeZoomWindow(val, xs) {
  const max = xs.length ? xs[xs.length - 1] : Date.now() / 1000
  const min = xs.length ? xs[0] : max - 86400
  switch (val) {
    case 'day':
      return [max - 86400, max]
    case 'wk':
      return [max - 604800, max]
    case 'mo':
      return [max - 2628000, max]
    default:
      return [min, max]
  }
}

export default class extends Controller {
  static get targets() {
    return ['zoom', 'bars', 'age', 'wrapper', 'outputs', 'purchasesRanger', 'priceRanger']
  }

  initialize() {
    this.mempool = false
    this.tipHeight = 0
    this.purchasesHandle = null
    this.priceHandle = null
    this.purchasesTooltip = null
    this.priceTooltip = null
    this.purchasesRanger = null
    this.priceRanger = null
    this.zoom = 'all'
    this.bars = 'all'
  }

  connect() {
    this.newblockUnsub = ws.registerEvtHandler('newblock', () => {
      ws.send('getticketpooldata', this.bars)
    })

    ws.registerEvtHandler('getticketpooldataResp', (evt) => {
      if (evt === '') {
        return
      }
      const data = JSON.parse(evt)
      this.processData(data)
    })

    this.reconnectUnsub = ws.registerEvtHandler('reconnect', () => {
      ws.send('getticketpooldata', this.bars)
    })

    this.processNightMode = () => this.redrawTheme()
    globalEventBus.on('NIGHT_MODE', this.processNightMode)

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
      const mempool = this.tipHeight === data.height ? this.mempool : false
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

  async renderOrUpdatePurchases(timeData, mempool) {
    const cols = ticketpoolPurchases.toColumns(timeData, mempool)
    if (this.purchasesHandle) {
      this.purchasesHandle.setData(cols)
      if (this.purchasesRanger) this.purchasesRanger.setData([cols[0], cols[3]])
      return
    }
    const el = document.getElementById('tickets-by-purchase-date')
    this.purchasesHandle = await createChart(el, ticketpoolPurchases, {
      dark: darkEnabled(),
      width: el.clientWidth || 800,
      height: el.clientHeight || 250,
      xTime: true,
      hooks: {
        ready: [
          (u) => {
            this.purchasesTooltip = installTooltip(u)
          }
        ],
        setCursor: [
          (u) => {
            renderTooltip(u, this.purchasesTooltip, ticketpoolPurchases)
          }
        ],
        setScale: [
          (u, key) => {
            if (key === 'x' && this.purchasesRanger) {
              this.purchasesRanger.setSelection(u.scales.x.min, u.scales.x.max)
            }
          }
        ]
      }
    })
    this.purchasesHandle.setData(cols)
    this.purchasesRanger = await createRanger(
      this.purchasesRangerTarget,
      { ...ticketpoolPurchases, series: [{ ...ticketpoolPurchases.series[2], colorIndex: 0 }] },
      {
        dark: darkEnabled(),
        width: this.purchasesRangerTarget.clientWidth || el.clientWidth || 800,
        xTime: true,
        onSelect: (min, max) => this.purchasesHandle.setXRange(min, max)
      }
    )
    this.purchasesRanger.setData([cols[0], cols[3]])
    const ru0 = this.purchasesRanger.uplot
    ru0.setSelect({ left: 0, top: 0, width: ru0.width, height: ru0.height }, false)
  }

  async renderOrUpdatePrice(priceData, mempool) {
    const cols = ticketpoolPrice.toColumns(priceData, mempool)
    if (this.priceHandle) {
      this.priceHandle.setData(cols)
      if (this.priceRanger) this.priceRanger.setData([cols[0], cols[3]])
      return
    }
    const el = document.getElementById('tickets-by-purchase-price')
    this.priceHandle = await createChart(el, ticketpoolPrice, {
      dark: darkEnabled(),
      width: el.clientWidth || 800,
      height: el.clientHeight || 250,
      xTime: false,
      hooks: {
        ready: [
          (u) => {
            this.priceTooltip = installTooltip(u)
          }
        ],
        setCursor: [
          (u) => {
            renderTooltip(u, this.priceTooltip, ticketpoolPrice)
          }
        ],
        setScale: [
          (u, key) => {
            if (key === 'x' && this.priceRanger) {
              this.priceRanger.setSelection(u.scales.x.min, u.scales.x.max)
            }
          }
        ]
      }
    })
    this.priceHandle.setData(cols)
    this.priceRanger = await createRanger(
      this.priceRangerTarget,
      { ...ticketpoolPrice, series: [{ ...ticketpoolPrice.series[2], colorIndex: 0 }] },
      {
        dark: darkEnabled(),
        width: this.priceRangerTarget.clientWidth || el.clientWidth || 800,
        xTime: false,
        onSelect: (min, max) => this.priceHandle.setXRange(min, max)
      }
    )
    this.priceRanger.setData([cols[0], cols[3]])
    const ru1 = this.priceRanger.uplot
    ru1.setSelect({ left: 0, top: 0, width: ru1.width, height: ru1.height }, false)
  }

  redrawTheme() {
    const dark = darkEnabled()

    const sx0 = this.purchasesHandle?.uplot.scales.x
    const range0 = sx0?.min != null && sx0?.max != null ? [sx0.min, sx0.max] : null
    const sx1 = this.priceHandle?.uplot.scales.x
    const range1 = sx1?.min != null && sx1?.max != null ? [sx1.min, sx1.max] : null

    this.purchasesHandle?.setDark(dark)
    this.priceHandle?.setDark(dark)

    if (this.purchasesRanger) {
      this.purchasesRanger.setDark(dark)
      queueMicrotask(() => {
        if (!this.purchasesRanger) return
        const xs = this.purchasesRanger.uplot.data[0]
        if (range0) this.purchasesRanger.setSelection(range0[0], range0[1])
        else if (xs?.length) this.purchasesRanger.setSelection(xs[0], xs[xs.length - 1])
      })
    }

    if (this.priceRanger) {
      this.priceRanger.setDark(dark)
      queueMicrotask(() => {
        if (!this.priceRanger) return
        const xs = this.priceRanger.uplot.data[0]
        if (range1) this.priceRanger.setSelection(range1[0], range1[1])
        else if (xs?.length) this.priceRanger.setSelection(xs[0], xs[xs.length - 1])
      })
    }
  }

  disconnect() {
    this.newblockUnsub()
    this.reconnectUnsub()
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    ws.deregisterEvtHandlers('getticketpooldataResp')
    this.purchasesHandle?.destroy()
    this.priceHandle?.destroy()
    this.purchasesRanger?.destroy()
    this.priceRanger?.destroy()
  }

  onZoom(e) {
    const target = e.srcElement || e.target
    this.zoomTargets.forEach((zoomTarget) => {
      zoomTarget.classList.remove('btn-active')
    })
    target.classList.add('btn-active')
    this.zoom = e.target.name
    if (!this.purchasesHandle) return
    const xs = this.purchasesHandle.uplot.data[0]
    const [lo, hi] = computeZoomWindow(this.zoom, xs)
    this.purchasesHandle.setXRange(lo, hi)
    if (this.purchasesRanger) this.purchasesRanger.setSelection(lo, hi)
  }

  async onBarsChange(e) {
    const target = e.srcElement || e.target
    this.barsTargets.forEach((barsTarget) => {
      barsTarget.classList.remove('btn-active')
    })
    this.bars = e.target.name
    target.classList.add('btn-active')
    this.wrapperTarget.classList.add('loading')
    const url = `/api/ticketpool/bydate/${this.bars}`
    const ticketPoolResponse = await requestJSON(url)
    const cols = ticketpoolPurchases.toColumns(ticketPoolResponse.time_chart)
    if (this.purchasesHandle) {
      this.purchasesHandle.setData(cols)
      this.purchasesRanger?.setData([cols[0], cols[3]])
    }
    this.wrapperTarget.classList.remove('loading')
  }
}
