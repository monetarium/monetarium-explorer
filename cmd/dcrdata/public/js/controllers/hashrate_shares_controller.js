/* global Turbolinks */
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import { OTHERS_COLOR, colorForIndex } from '../helpers/chart_theme'

// Pie geometry constants (SVG viewBox is 360x360).
export const PIE = { cx: 180, cy: 180, r: 165, labelR: 110 }

// Number of individually-drawn pie slices / individually-listed table rows.
// Miners ranked beyond this are folded into a single "Others" slice and a single
// "Others" table row. Matches PALETTE.length so every drawn slice has its own color.
export const PIE_SLICES = 25

// Minimum slice sweep (radians) for a rank number to fit inside the slice.
export const MIN_LABEL_SWEEP = 0.18 // ~10.3 degrees

// Interval filters (mirrors the backend's accepted ?interval values).
export const INTERVALS = ['all', 'year', 'month', 'week', 'day']
export const DEFAULT_INTERVAL = 'week'

// Distinct empty-table messages: a genuinely empty period and a fetch failure
// must read differently so a 500/network error is not mistaken for "no data".
export const EMPTY_MESSAGE = 'No PoW Reward transactions in the selected period.'
export const ERROR_MESSAGE = 'Could not load hashrate shares. Please try again.'

export function emptyStateMessage(isError) {
  return isError ? ERROR_MESSAGE : EMPTY_MESSAGE
}

// swatchColor maps a 1-based miner rank to its color: ranks drawn in the pie get
// their slice color; ranks folded into "Others" get the grey aggregate color.
export function swatchColor(rank) {
  return rank >= 1 && rank <= PIE_SLICES ? colorForIndex(rank - 1) : OTHERS_COLOR
}

// pieSlices reduces the full ranked miner list to what the pie and the table draw:
// the top PIE_SLICES miners verbatim, plus a single { isOthers, count, percent }
// aggregate for the remainder, where percent is the combined share of every miner
// ranked beyond PIE_SLICES (1 decimal place, matching the per-miner percents).
// Returns the input unchanged when it already fits, so a list of <= PIE_SLICES
// miners draws no "Others" slice and shows no "Others" row.
export function pieSlices(miners, maxSlices = PIE_SLICES) {
  if (miners.length <= maxSlices) return miners
  const top = miners.slice(0, maxSlices)
  let total = 0
  for (const m of miners) total += Number(m.count)
  let othersCount = 0
  for (let i = maxSlices; i < miners.length; i++) othersCount += Number(miners[i].count)
  const othersPercent = total > 0 ? ((othersCount / total) * 100).toFixed(1) : '0.0'
  return [...top, { isOthers: true, count: othersCount, percent: othersPercent }]
}

// copyIconNode builds the clipboard control appended to each address cell. It
// mirrors the "copyTextIcon" template: the clipboard controller copies the cell
// text (the full address), and the empty alert span shows the "Copied" toast.
function copyIconNode() {
  const frag = document.createDocumentFragment()
  const icon = document.createElement('span')
  icon.className = 'monicon-copy clickable'
  icon.dataset.controller = 'clipboard'
  icon.dataset.action = 'click->clipboard#copyTextToClipboard'
  const alert = document.createElement('span')
  alert.className = 'alert alert-secondary alert-copy'
  // Whitespace between the icon and the alert keeps the transient "Copied" toast
  // a separate token, so clipboard#copyTextToClipboard (which reads the cell's
  // textContent up to the first space) always copies the address, never "…Copied".
  frag.append(icon, ' ', alert)
  return frag
}

// buildRows clones the row <template> once per entry and fills each cell via
// textContent / DOM nodes, returning the resulting <tr> elements. Each entry is
// either a ranked miner or the trailing { isOthers, count, percent } aggregate.
//
// No HTML is parsed from the data, so untrusted values (reward addresses) stay
// inert without a sanitizer — humanize.hashElide sets the address via
// textContent, which never interprets markup. Cloning a <template> also
// preserves the <tr>/<td> structure, which a row string fed through innerHTML
// would lose (the HTML parser drops bare table tags outside a table context).
export function buildRows(rowTemplate, miners) {
  return miners.map((m) => {
    const row = document.importNode(rowTemplate.content, true).querySelector('tr')
    row.querySelector('[data-type="rank"]').textContent = m.isOthers ? '' : String(m.rank)
    row.querySelector('[data-type="swatch"]').style.background = m.isOthers
      ? OTHERS_COLOR
      : swatchColor(m.rank)
    row.querySelector('[data-type="percent"]').textContent = `${m.percent}%`

    const addr = row.querySelector('[data-type="addr"]')
    if (m.isOthers) {
      // The aggregate of every miner ranked beyond the pie — no address, no link.
      const span = document.createElement('span')
      span.className = 'text-secondary'
      span.textContent = 'Others'
      addr.appendChild(span)
    } else {
      // Responsive, copyable address: hashElide renders the full address (shown in
      // full when the column is wide, middle-elided when narrow), and the copy
      // icon copies the cell's text — the address — via the clipboard controller.
      addr.append(humanize.hashElide(m.address, `/address/${m.address}`, true), copyIconNode())
    }
    return row
  })
}

// CSV_HEADER names the Download CSV columns. snake_case mirrors the address
// page's server-streamed CSV (tx_hash, io_index, …) for a consistent export
// convention across the explorer.
export const CSV_HEADER = ['rank', 'reward_address', 'reward_tx_count', 'percent']

// csvField escapes one value per RFC 4180: a field is quoted only when it
// contains a comma, double-quote, or newline, and embedded quotes are doubled.
// Reward addresses are the only operator-influenced field, so this keeps a
// hostile address from breaking out of its column.
function csvField(value) {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// buildCsv serializes the full ranked miner list to an RFC 4180 CSV string. The
// whole dataset already lives client-side (this.miners), so the export needs no
// server round-trip — and it exports every miner individually, not the capped
// top-25 + "Others" view shown in the table. Records are CRLF-terminated
// (including the last), matching Go's csv.Writer.
export function buildCsv(miners) {
  const lines = [CSV_HEADER.join(',')]
  for (const m of miners) {
    lines.push([m.rank, m.address, m.count, m.percent].map(csvField).join(','))
  }
  return lines.map((line) => `${line}\r\n`).join('')
}

export function sliceLabelFits(sweepRadians) {
  return sweepRadians >= MIN_LABEL_SWEEP
}

// arcPath returns an SVG wedge path from the pie center spanning [start, end]
// (radians, clockwise from +x axis).
export function arcPath(start, end) {
  const { cx, cy, r } = PIE
  const x1 = cx + r * Math.cos(start)
  const y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const largeArc = end - start > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

const SVGNS = 'http://www.w3.org/2000/svg'

export default class extends Controller {
  static targets = [
    'pie',
    'tableBody',
    'rowTemplate',
    'intervalOption',
    'empty',
    'pieWrap',
    'downloadWrap'
  ]

  connect() {
    this.miners = []
    this._reqSeq = 0

    // Project the URL query onto the view state so the selected interval is
    // shareable and survives reload (mirrors the address page).
    this.query = new TurboQuery()
    const settings = (this.settings = TurboQuery.nullTemplate(['interval']))
    this.query.update(settings)

    this.interval = INTERVALS.includes(settings.interval) ? settings.interval : DEFAULT_INTERVAL

    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  nextSeq() {
    this._reqSeq += 1
    return this._reqSeq
  }

  // syncControlsUI reflects the current state onto the interval pills (which are
  // server-rendered with a static default).
  syncControlsUI() {
    this.intervalOptionTargets.forEach((el) => {
      el.classList.toggle('active', el.dataset.option === this.interval)
    })
  }

  // syncUrl writes the canonical state back to the address bar, omitting the
  // interval when it equals the default so a pristine view stays at a clean
  // /hashrate-shares.
  syncUrl() {
    this.settings.interval = this.interval === DEFAULT_INTERVAL ? null : this.interval
    this.query.replace(this.settings)
  }

  setInterval(e) {
    const option = e.currentTarget.dataset.option
    if (option === this.interval) return
    this.interval = option
    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  // downloadCsv exports the full ranked miner list (every miner, not the capped
  // top-25 + "Others" view) as a CSV file, built client-side from this.miners.
  // The address page streams its CSV from the server because its rows are
  // server-paginated; here the whole dataset is already in the browser, so a Blob
  // download avoids a round-trip. The interval is baked into the filename so the
  // export is self-describing.
  downloadCsv(e) {
    if (e) e.preventDefault()
    if (!this.miners.length) return
    const blob = new Blob([buildCsv(this.miners)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hashrate-shares-${this.interval}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Defer the revoke to the next tick: some browsers (e.g. Safari/WebKit)
    // initiate the click-triggered download asynchronously, and revoking the
    // blob URL synchronously can invalidate it before the download reads it.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // Navigate to /charts for any non-hashrate-shares selection (parity with the
  // CHART <select> on /charts).
  selectChart(e) {
    const value = e.currentTarget.value
    if (value === 'hashrate-shares') return
    Turbolinks.visit(`/charts?chart=${encodeURIComponent(value)}`)
  }

  async fetchAndRender(seq) {
    let data
    try {
      data = await requestJSON(`/hashrate-shares/data?interval=${this.interval}`)
    } catch (err) {
      if (seq !== this._reqSeq) return
      console.error('hashrate-shares fetch failed', err)
      this.miners = []
      this.renderTable([], true)
      this.renderPie([])
      return
    }
    if (seq !== this._reqSeq) return
    this.miners = (data && data.miners) || []
    // Compute the top-PIE_SLICES + "Others" view once and render the table and the
    // pie from the same array, so the two can never disagree (issue #474 AC4).
    const slices = pieSlices(this.miners)
    this.renderTable(slices)
    this.renderPie(slices)
  }

  renderTable(slices, isError = false) {
    const empty = !slices.length
    this.emptyTarget.classList.toggle('d-hide', !empty)
    this.pieWrapTarget.classList.toggle('d-hide', empty)
    // The Download CSV control only makes sense when there is data to export.
    if (this.hasDownloadWrapTarget) this.downloadWrapTarget.classList.toggle('d-hide', empty)
    if (empty) {
      this.emptyTarget.textContent = emptyStateMessage(isError)
      this.tableBodyTarget.replaceChildren()
      return
    }
    // slices is the same array the pie renders: the top PIE_SLICES miners
    // individually, plus a single "Others" aggregate row when there are more
    // (issue #474).
    this.tableBodyTarget.replaceChildren(...buildRows(this.rowTemplateTarget, slices))
  }

  renderPie(slices) {
    const svg = this.pieTarget
    svg.innerHTML = ''
    if (!slices.length) return

    const total = slices.reduce((acc, m) => acc + Number(m.count), 0)
    if (total <= 0) return

    // Single slice cannot be drawn as a wedge arc — use a full circle.
    if (slices.length === 1) {
      const c = document.createElementNS(SVGNS, 'circle')
      c.setAttribute('cx', PIE.cx)
      c.setAttribute('cy', PIE.cy)
      c.setAttribute('r', PIE.r)
      c.setAttribute('fill', colorForIndex(0))
      svg.appendChild(c)
      return
    }

    let angle = -Math.PI / 2 // start at 12 o'clock
    slices.forEach((m, i) => {
      const sweep = (Number(m.count) / total) * 2 * Math.PI
      const start = angle
      const end = angle + sweep
      angle = end

      const path = document.createElementNS(SVGNS, 'path')
      path.setAttribute('d', arcPath(start, end))
      path.setAttribute('fill', m.isOthers ? OTHERS_COLOR : colorForIndex(i))
      path.setAttribute('stroke', 'var(--hashrate-shares-stroke, #fff)')
      path.setAttribute('stroke-width', '1')
      svg.appendChild(path)

      // Rank number only when it fits and the slice is not "Others".
      if (!m.isOthers && sliceLabelFits(sweep)) {
        const mid = (start + end) / 2
        const lx = PIE.cx + PIE.labelR * Math.cos(mid)
        const ly = PIE.cy + PIE.labelR * Math.sin(mid)
        const text = document.createElementNS(SVGNS, 'text')
        text.setAttribute('x', lx.toFixed(1))
        text.setAttribute('y', ly.toFixed(1))
        text.setAttribute('text-anchor', 'middle')
        text.setAttribute('dominant-baseline', 'central')
        text.setAttribute('class', 'hashrate-shares-rank')
        text.textContent = String(m.rank)
        svg.appendChild(text)
      }
    })
  }
}
