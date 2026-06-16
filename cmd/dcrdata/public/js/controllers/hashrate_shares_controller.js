/* global Turbolinks */
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbolinks_helper'

// Pie geometry constants (SVG viewBox is 360x360).
export const PIE = { cx: 180, cy: 180, r: 165, labelR: 110 }

// Fixed 25-color categorical palette (visually distinct in light and dark themes).
export const PALETTE = [
  '#2970FF',
  '#E03131',
  '#2DB35E',
  '#F08C00',
  '#1098AD',
  '#7048E8',
  '#E64980',
  '#0B7285',
  '#F59F00',
  '#495057',
  '#4263EB',
  '#74B816',
  '#D6336C',
  '#1864AB',
  '#9C36B5',
  '#0CA678',
  '#E8590C',
  '#3B5BDB',
  '#66A80F',
  '#C2255C',
  '#5C940D',
  '#A61E4D',
  '#364FC7',
  '#087F5B',
  '#862E9C'
]
export const OTHERS_COLOR = '#adb5bd'

// Number of individually-drawn pie slices. Miners ranked beyond this are folded
// into a single "Others" slice; their table rows get the grey "Others" swatch.
// Matches PALETTE.length so every drawn slice has its own color.
export const PIE_SLICES = 25

// Minimum slice sweep (radians) for a rank number to fit inside the slice.
export const MIN_LABEL_SWEEP = 0.18 // ~10.3 degrees

// Interval filters (mirrors the backend's accepted ?interval values) and table
// page sizes. The default page size equals PIE_SLICES so page 1 lines up exactly
// with the pie's drawn slices.
export const INTERVALS = ['all', 'year', 'month', 'week', 'day']
export const DEFAULT_INTERVAL = 'week'
export const PAGE_SIZES = [25, 50, 100]
export const DEFAULT_PAGE_SIZE = 25

// Distinct empty-table messages: a genuinely empty period and a fetch failure
// must read differently so a 500/network error is not mistaken for "no data".
export const EMPTY_MESSAGE = 'No PoW Reward transactions in the selected period.'
export const ERROR_MESSAGE = 'Could not load hashrate shares. Please try again.'

export function emptyStateMessage(isError) {
  return isError ? ERROR_MESSAGE : EMPTY_MESSAGE
}

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length]
}

// swatchColor maps a 1-based miner rank to its color: ranks drawn in the pie get
// their slice color; ranks folded into "Others" get the grey aggregate color.
export function swatchColor(rank) {
  return rank >= 1 && rank <= PIE_SLICES ? colorForIndex(rank - 1) : OTHERS_COLOR
}

// pieSlices reduces the full ranked miner list to what the pie draws: the top
// PIE_SLICES miners verbatim, plus a single { isOthers, count } aggregate for the
// remainder. Returns the input unchanged when it already fits.
export function pieSlices(miners, maxSlices = PIE_SLICES) {
  if (miners.length <= maxSlices) return miners
  const top = miners.slice(0, maxSlices)
  let othersCount = 0
  for (let i = maxSlices; i < miners.length; i++) othersCount += Number(miners[i].count)
  return [...top, { isOthers: true, count: othersCount }]
}

export function pageCount(total, pageSize) {
  if (total <= 0 || pageSize <= 0) return 0
  return Math.ceil(total / pageSize)
}

export function clampPage(page, totalPages) {
  if (totalPages <= 0) return 1
  if (!Number.isInteger(page) || page < 1) return 1
  if (page > totalPages) return totalPages
  return page
}

export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

// pageItems returns the page-button sequence for a windowed pager: always the
// first and last page, the current page and its neighbors, and the literal
// 'ellipsis' marker wherever a gap is skipped. Empty when there is a single page.
export function pageItems(current, totalPages) {
  if (totalPages <= 1) return []
  const nums = new Set([1, totalPages, current, current - 1, current + 1])
  const sorted = [...nums].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const items = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) items.push('ellipsis')
    items.push(p)
    prev = p
  }
  return items
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

// buildRows clones the row <template> once per miner and fills each cell via
// textContent / DOM nodes, returning the resulting <tr> elements.
//
// No HTML is parsed from the data, so untrusted values (reward addresses) stay
// inert without a sanitizer — humanize.hashElide sets the address via
// textContent, which never interprets markup. Cloning a <template> also
// preserves the <tr>/<td> structure, which a row string fed through innerHTML
// would lose (the HTML parser drops bare table tags outside a table context).
export function buildRows(rowTemplate, miners) {
  return miners.map((m) => {
    const row = document.importNode(rowTemplate.content, true).querySelector('tr')
    row.querySelector('[data-type="rank"]').textContent = String(m.rank)
    row.querySelector('[data-type="swatch"]').style.background = swatchColor(m.rank)
    row.querySelector('[data-type="percent"]').textContent = `${m.percent}%`

    // Responsive, copyable address: hashElide renders the full address (shown in
    // full when the column is wide, middle-elided when narrow), and the copy
    // icon copies the cell's text — the address — via the clipboard controller.
    const addr = row.querySelector('[data-type="addr"]')
    addr.append(humanize.hashElide(m.address, `/address/${m.address}`, true), copyIconNode())
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
// server round-trip — unlike the address page, whose rows are server-paginated.
// Records are CRLF-terminated (including the last), matching Go's csv.Writer.
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
    'paginationheader',
    'range',
    'pagebuttons',
    'pageminus',
    'pageplus',
    'tablePagination',
    'pageSizeWrap',
    'pageSize'
  ]

  connect() {
    this.miners = []
    this._reqSeq = 0

    // Project the URL query onto the view state so filters/pagination are
    // shareable and survive reload (mirrors the address page).
    this.query = new TurboQuery()
    const settings = (this.settings = TurboQuery.nullTemplate(['interval', 'page', 'n']))
    this.query.update(settings)

    this.interval = INTERVALS.includes(settings.interval) ? settings.interval : DEFAULT_INTERVAL
    this.pageSize = PAGE_SIZES.includes(settings.n) ? settings.n : DEFAULT_PAGE_SIZE
    this.page = Number.isInteger(settings.page) && settings.page > 0 ? settings.page : 1

    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  nextSeq() {
    this._reqSeq += 1
    return this._reqSeq
  }

  // syncControlsUI reflects the current state onto the interval pills and the
  // page-size selector (which are server-rendered with static defaults).
  syncControlsUI() {
    this.intervalOptionTargets.forEach((el) => {
      el.classList.toggle('active', el.dataset.option === this.interval)
    })
    if (this.hasPageSizeTarget) this.pageSizeTarget.value = String(this.pageSize)
  }

  // syncUrl writes the canonical state back to the address bar, omitting values
  // that equal their default so a pristine view stays at a clean /hashrate-shares.
  syncUrl() {
    this.settings.interval = this.interval === DEFAULT_INTERVAL ? null : this.interval
    this.settings.page = this.page > 1 ? this.page : null
    this.settings.n = this.pageSize === DEFAULT_PAGE_SIZE ? null : this.pageSize
    this.query.replace(this.settings)
  }

  setInterval(e) {
    const option = e.currentTarget.dataset.option
    if (option === this.interval) return
    this.interval = option
    this.page = 1 // a new period invalidates the current page
    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  changePageSize() {
    const n = parseInt(this.pageSizeTarget.value, 10)
    this.pageSize = PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE
    this.page = 1 // page indices shift when the size changes
    this.syncUrl()
    this.renderTable(this.miners)
  }

  goToPage(e) {
    e.preventDefault()
    this.setPage(parseInt(e.currentTarget.dataset.page, 10))
  }

  // downloadCsv exports the full ranked miner list (every page, not just the
  // visible one) as a CSV file, built client-side from this.miners. The address
  // page streams its CSV from the server because its rows are server-paginated;
  // here the whole dataset is already in the browser, so a Blob download avoids a
  // round-trip. The interval is baked into the filename so the export is
  // self-describing.
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

  prevPage(e) {
    if (e) e.preventDefault()
    this.setPage(this.page - 1)
  }

  nextPage(e) {
    if (e) e.preventDefault()
    this.setPage(this.page + 1)
  }

  // setPage clamps to the valid range first (so the URL never records an
  // out-of-range page), then re-renders the table slice. No refetch — the full
  // ranked list is already client-side.
  setPage(page) {
    const totalPages = pageCount(this.miners.length, this.pageSize)
    const clamped = clampPage(page, totalPages)
    if (clamped === this.page) return
    this.page = clamped
    this.syncUrl()
    this.renderTable(this.miners)
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
    this.renderTable(this.miners)
    this.renderPie(pieSlices(this.miners))
  }

  renderTable(miners, isError = false) {
    const empty = !miners.length
    this.emptyTarget.classList.toggle('d-hide', !empty)
    this.pieWrapTarget.classList.toggle('d-hide', empty)
    // Pagination chrome only makes sense when there is data.
    if (this.hasPaginationheaderTarget) {
      this.paginationheaderTarget.classList.toggle('d-hide', empty)
    }
    if (this.hasPageSizeWrapTarget) this.pageSizeWrapTarget.classList.toggle('d-hide', empty)
    if (empty) {
      this.emptyTarget.textContent = emptyStateMessage(isError)
      this.tableBodyTarget.replaceChildren()
      if (this.hasTablePaginationTarget) this.tablePaginationTarget.classList.add('d-hide')
      return
    }

    const totalPages = pageCount(miners.length, this.pageSize)
    this.page = clampPage(this.page, totalPages)
    // Re-sync the URL to the page actually shown: a deep-linked or stale
    // out-of-range ?page= is clamped here, and without this the address bar
    // would keep recording a page that is not the one on screen (the single-page
    // pager is hidden, so the user could not otherwise correct it).
    this.syncUrl()
    const pageRows = paginate(miners, this.page, this.pageSize)
    this.tableBodyTarget.replaceChildren(...buildRows(this.rowTemplateTarget, pageRows))
    this.renderPagination(miners.length, totalPages)
  }

  // renderPagination updates the range text, the header Previous/Next pills (which
  // hide entirely on a single page, mirroring the address page), and the numbered
  // pager below the table.
  renderPagination(totalItems, totalPages) {
    if (this.hasRangeTarget) {
      const first = (this.page - 1) * this.pageSize + 1
      const last = Math.min(this.page * this.pageSize, totalItems)
      const suffix = totalItems === 1 ? '' : 's'
      // Literal en-dash via textContent (not innerHTML) — no markup, no injection.
      this.rangeTarget.textContent =
        `showing ${first.toLocaleString()} – ${last.toLocaleString()} of ` +
        `${totalItems.toLocaleString()} miner${suffix}`
    }
    if (this.hasPagebuttonsTarget) {
      this.pagebuttonsTarget.classList.toggle('d-hide', totalPages <= 1)
    }
    if (this.hasPageminusTarget) {
      this.pageminusTarget.classList.toggle('disabled', this.page <= 1)
    }
    if (this.hasPageplusTarget) {
      this.pageplusTarget.classList.toggle('disabled', this.page >= totalPages)
    }
    this.renderNumberedPager(totalPages)
  }

  // renderNumberedPager fills the bottom pager with windowed page-number links and
  // left/right arrows — the same control the address transactions table uses. It
  // is hidden when there is a single page (pageItems returns nothing).
  renderNumberedPager(totalPages) {
    if (!this.hasTablePaginationTarget) return
    const container = this.tablePaginationTarget
    const items = pageItems(this.page, totalPages)
    if (!items.length) {
      container.classList.add('d-hide')
      container.replaceChildren()
      return
    }
    container.classList.remove('d-hide')

    const nodes = []
    if (this.page > 1) nodes.push(this.arrowLink('left', this.page - 1))
    items.forEach((item) => {
      if (item === 'ellipsis') {
        const span = document.createElement('span')
        span.textContent = '…'
        nodes.push(span)
        return
      }
      const a = document.createElement('a')
      a.className = `fs18 pager px-1${item === this.page ? ' active' : ''}`
      a.href = '#'
      a.textContent = String(item)
      a.dataset.page = String(item)
      a.dataset.action = 'click->hashrate-shares#goToPage'
      nodes.push(a)
    })
    if (this.page < totalPages) nodes.push(this.arrowLink('right', this.page + 1))
    container.replaceChildren(...nodes)
  }

  arrowLink(dir, page) {
    const a = document.createElement('a')
    // fz20/fs20 mirror the address page's markup (the classes are cosmetic
    // no-ops; the monicon glyph sets the arrow size).
    const sizeClass = dir === 'left' ? 'fz20' : 'fs20'
    a.className = `d-inline-block monicon-arrow-${dir} m-1 ${sizeClass}`
    a.href = '#'
    a.dataset.page = String(page)
    a.dataset.action = 'click->hashrate-shares#goToPage'
    return a
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
