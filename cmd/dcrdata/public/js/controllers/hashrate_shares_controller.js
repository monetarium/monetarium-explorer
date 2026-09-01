/* global Turbo, requestAnimationFrame */
import '@hotwired/turbo'
import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import TurboQuery from '../helpers/turbo_helper'
import { OTHERS_COLOR, colorForIndex } from '../helpers/chart_theme'

// Pie geometry constants (SVG viewBox is 360x360).
export const PIE = { cx: 180, cy: 180, r: 165, labelR: 110 }

// Number of individually-drawn pie slices. Miners ranked beyond this are folded
// into a single "Others" slice. Matches the shared PALETTE length (in
// chart_theme) so every drawn slice has its own color. This limits the PIE
// only — the table draws the full list (spec §5.3).
export const PIE_SLICES = 25

// Minimum slice sweep (radians) for a rank number to fit inside the slice.
export const MIN_LABEL_SWEEP = 0.18 // ~10.3 degrees

// Interval filters (mirrors the backend's accepted ?interval values).
export const INTERVALS = ['all', 'year', 'month', 'week', 'day']
export const DEFAULT_INTERVAL = 'week'

// Distinct empty-table messages: a genuinely empty period, a fetch failure and
// invalid block-range input must read differently so a 500/network error or a
// bad range is not mistaken for "no data" (spec §3.3).
export const EMPTY_MESSAGE = 'No PoW Reward transactions in the selected period.'
export const ERROR_MESSAGE = 'Could not load hashrate shares. Please try again.'
export const INVALID_MESSAGE = 'Invalid block range. Enter non-negative heights with from ≤ to.'

export function emptyStateMessage(isError) {
  return isError ? ERROR_MESSAGE : EMPTY_MESSAGE
}

// errorStateMessage surfaces the backend's validation message when the failure
// is a 400 JSON error body ({ "error": "..." }), and falls back to the generic
// ERROR_MESSAGE for network failures / server errors (which have no body).
export function errorStateMessage(err) {
  if (err && err.message) {
    try {
      const body = JSON.parse(err.message)
      if (body && typeof body.error === 'string') return body.error
    } catch {
      // not the JSON error shape
    }
  }
  return ERROR_MESSAGE
}

// blockRangeFromParams validates raw URL query values for an explicit block
// range and returns { from, to }, or null when absent/invalid (non-numeric,
// negative, or from > to). Missing params (null/undefined/empty) mean "no range"
// and must return null — Number(null) is 0, so absent values must be rejected
// before coercion or a clean /hashrate-shares would parse as { from: 0, to: 0 }
// and activate range mode. The client check is convenience only — the server
// is authoritative (spec §3.3).
export function blockRangeFromParams(fromRaw, toRaw) {
  if (
    fromRaw === null ||
    fromRaw === undefined ||
    fromRaw === '' ||
    toRaw === null ||
    toRaw === undefined ||
    toRaw === ''
  ) {
    return null
  }
  const from = Number(fromRaw)
  const to = Number(toRaw)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from > to) {
    return null
  }
  return { from, to }
}

// dataUrl builds the /hashrate-shares/data endpoint URL for the current view
// state: an explicit block range when active, otherwise the interval param.
export function dataUrl(blockRange, interval) {
  if (blockRange) {
    return `/hashrate-shares/data?from=${blockRange.from}&to=${blockRange.to}`
  }
  return `/hashrate-shares/data?interval=${interval}`
}

// syncUrlQuery projects the view state onto the URL query settings. The block
// range is written as from/to (no interval param — the range has priority on
// the server, spec §3.2); a null from/to drops those params (TurboQuery's
// filteredQuery skips nulls). The address filter is orthogonal and shared.
export function syncUrlQuery(interval, blockRange, address, defaultInterval = DEFAULT_INTERVAL) {
  if (blockRange) {
    return {
      interval: null,
      from: blockRange.from,
      to: blockRange.to,
      address: address || null
    }
  }
  return {
    interval: interval === defaultInterval ? null : interval,
    from: null,
    to: null,
    address: address || null
  }
}

// swatchColor maps a 1-based miner rank to its color: ranks drawn in the pie get
// their slice color; ranks folded into "Others" get the grey aggregate color.
export function swatchColor(rank) {
  return rank >= 1 && rank <= PIE_SLICES ? colorForIndex(rank - 1) : OTHERS_COLOR
}

// pieSlices reduces the full ranked miner list to what the pie draws: the top
// PIE_SLICES miners verbatim, plus a single { isOthers, count, percent }
// aggregate for the remainder, where percent is the combined share of every
// miner ranked beyond PIE_SLICES (1 decimal place, matching the per-miner
// percents). Returns the input unchanged when it already fits.
export function pieSlices(miners, maxSlices = PIE_SLICES) {
  if (miners.length <= maxSlices) return miners
  const top = miners.slice(0, maxSlices)
  let total = 0
  for (const m of miners) total += Number(m.count)
  let othersCount = 0
  for (let i = maxSlices; i < miners.length; i++) othersCount += Number(miners[i].count)
  const othersPercent = total > 0 ? ((othersCount / total) * 100).toFixed(1) : '0.0'
  const othersAddrCount = miners.length - maxSlices
  return [
    ...top,
    { isOthers: true, count: othersCount, percent: othersPercent, addressCount: othersAddrCount }
  ]
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
// a ranked miner: the table draws the full list (spec §5.3), so there is no
// "Others" aggregate row here — the pie derives it separately via pieSlices.
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
    row.querySelector('[data-type="blocks"]').textContent = String(m.count)
    row.querySelector('[data-type="minerReward"]').textContent = humanize.formatAtomsAsCoinString(
      m.miner_reward,
      0,
      2
    )
    row.querySelector('[data-type="fees"]').textContent = humanize.formatAtomsAsCoinString(
      m.fees,
      0,
      2
    )

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
// convention across the explorer. The per-row total (miner_reward + fees) is
// deliberately not exported — it is derived (spec §6).
export const CSV_HEADER = ['rank', 'reward_address', 'blocks', 'miner_reward', 'fees', 'percent']

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
// server round-trip — and it exports every miner individually, not the pie's
// top-25 + "Others" view. Money columns are formatted as coin strings, matching
// the table. Records are CRLF-terminated (including the last), matching Go's
// csv.Writer.
export function buildCsv(miners) {
  const lines = [CSV_HEADER.join(',')]
  for (const m of miners) {
    lines.push(
      [
        m.rank,
        m.address,
        m.count,
        humanize.formatAtomsAsCoinString(m.miner_reward, 0, 2),
        humanize.formatAtomsAsCoinString(m.fees, 0, 2),
        m.percent
      ]
        .map(csvField)
        .join(',')
    )
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
    'downloadWrap',
    'blockRangeWrap',
    'fromInput',
    'toInput',
    'applyButton',
    'addressInput',
    'clearAddress',
    'truncatedNote',
    'scrollWrap',
    'addressCount'
  ]

  connect() {
    this.miners = []
    this.totals = null
    this.truncated = false
    // emptyState is why the empty slot is showing: null (no active message —
    // renderTable may write the generic empty message), 'invalid' (bad range
    // input) or 'error' (fetch failure). The last two are sticky until a
    // successful fetch, so an unrelated renderTable (typing in the address
    // filter) can't mislabel the message (spec §3.3).
    this.emptyState = null
    this.blockRange = null
    this.addressFilter = ''
    this._reqSeq = 0
    this._pendingAddressScroll = null

    // Project the URL query onto the view state so the selected period is
    // shareable and survives reload. The block range is carried as from/to; when
    // both are present and valid it takes precedence over any interval param.
    // The address filter is orthogonal and applies in either mode (spec §3.2).
    this.query = new TurboQuery()
    const settings = (this.settings = TurboQuery.nullTemplate([
      'interval',
      'from',
      'to',
      'address'
    ]))
    this.query.update(settings)

    const blockRange = blockRangeFromParams(settings.from, settings.to)
    if (blockRange) {
      this.blockRange = blockRange
      this.interval = 'custom'
      // Populate the From/To inputs so the view reproduces exactly what the
      // sender shared (not just the resulting data).
      this.fromInputTarget.value = blockRange.from
      this.toInputTarget.value = blockRange.to
    } else {
      this.interval = INTERVALS.includes(settings.interval) ? settings.interval : DEFAULT_INTERVAL
    }

    if (settings.address) {
      this.addressFilter = settings.address
      this.addressInputTarget.value = settings.address
      this._pendingAddressScroll = settings.address
    }

    // Keep the "more below" fade in step with the scroll position. Throttled
    // through rAF and registered passive, as in sticky_col_controller — the
    // one existing scroll-affordance in the app. The target is guarded because
    // the controller tests wire targets by hand, the same reason
    // hasDownloadWrapTarget is guarded below.
    this.ticking = false
    this._onScroll = () => {
      if (this.ticking) return
      this.ticking = true
      requestAnimationFrame(() => {
        this.updateScrollShadow()
        this.ticking = false
      })
    }
    if (this.hasScrollWrapTarget) {
      this.scrollWrapTarget.addEventListener('scroll', this._onScroll, { passive: true })
    }

    this.toggleClearButton()
    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  disconnect() {
    if (this.hasScrollWrapTarget && this._onScroll) {
      this.scrollWrapTarget.removeEventListener('scroll', this._onScroll)
    }
  }

  // updateScrollShadow shows the bottom fade only while rows remain below the
  // fold: a list that fits and a list scrolled to its end both resolve to zero
  // remaining distance and hide it. It runs after every path that rewrites the
  // rows, because filtering can turn an overflowing list into a fitting one.
  updateScrollShadow() {
    if (!this.hasScrollWrapTarget) return
    const el = this.scrollWrapTarget
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    el.classList.toggle('hashrate-shares-scroll-more', remaining > 1)
  }

  nextSeq() {
    this._reqSeq += 1
    return this._reqSeq
  }

  // syncControlsUI reflects the current mode onto the controls: the interval
  // pills (which are server-rendered with a static default) and the block-range
  // From/To + Apply group. The Apply control is styled as an interval pill, so
  // it lights up exactly like a selected pill while a custom range is active
  // and reads as a plain inactive pill when any interval is selected.
  syncControlsUI() {
    this.intervalOptionTargets.forEach((el) => {
      el.classList.toggle('active', el.dataset.option === this.interval)
    })
    const rangeActive = this.interval === 'custom' && !!this.blockRange
    this.applyButtonTarget.classList.toggle('active', rangeActive)
    this.blockRangeWrapTarget.classList.toggle('block-range-active', rangeActive)
  }

  // syncUrl writes the canonical state back to the address bar. The interval is
  // omitted when it equals the default so a pristine view stays at a clean
  // /hashrate-shares; the block range is written as from/to (no interval param)
  // and the address filter as address, both only when non-empty.
  syncUrl() {
    const q = syncUrlQuery(this.interval, this.blockRange, this.addressFilter)
    this.settings.interval = q.interval
    this.settings.from = q.from
    this.settings.to = q.to
    this.settings.address = q.address
    this.query.replace(this.settings)
  }

  // setInterval switches to one of the interval pills. Picking an interval
  // deactivates the block-range mode and clears its inputs (spec §3.1).
  setInterval(e) {
    const option = e.currentTarget.dataset.option
    if (option === this.interval) return
    this.blockRange = null
    this.interval = option
    this.clearRangeInputs()
    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  // applyBlockRange activates the explicit block-range mode from the From/To
  // inputs (spec §3.1). Empty From and To mean the range mode is not active, so
  // a blank form leaves the current mode untouched — erroring there would fight
  // the spec, which says the page then behaves as today (default week). A
  // half-filled form (one field blank) is incomplete input and is rejected like
  // any other invalid range. Client-side validation is convenience only — the
  // server re-validates and rejects with its own message (§3.3).
  applyBlockRange(e) {
    if (e) e.preventDefault()
    const fromRaw = this.fromInputTarget.value
    const toRaw = this.toInputTarget.value
    if (fromRaw.trim() === '' && toRaw.trim() === '') return
    const range = blockRangeFromParams(fromRaw, toRaw)
    if (!range) {
      // Mark the state sticky: only a successful fetch clears it, so the
      // message survives later renderTable calls.
      this.emptyState = 'invalid'
      this.showEmpty(INVALID_MESSAGE)
      return
    }
    this.blockRange = range
    this.interval = 'custom'
    this.syncControlsUI()
    this.syncUrl()
    this.fetchAndRender(this.nextSeq())
  }

  // clearRangeInputs empties the From/To fields when leaving the block-range
  // mode (spec §3.1).
  clearRangeInputs() {
    this.fromInputTarget.value = ''
    this.toInputTarget.value = ''
  }

  // filterByAddress narrows the already-loaded list to addresses containing the
  // query, keeping the real rank. It never affects the pie or percents, which
  // are computed over the whole period (spec §3.2).
  filterByAddress() {
    this.addressFilter = this.addressInputTarget.value.trim()
    this.toggleClearButton()
    this.syncUrl()
    this.renderTable()
  }

  // toggleClearButton shows/hides the clear button based on whether the address
  // filter has a value.
  toggleClearButton() {
    this.clearAddressTarget.classList.toggle('d-none', !this.addressFilter)
  }

  // clearAddress clears the address filter input and re-renders the table.
  clearAddress() {
    this.addressInputTarget.value = ''
    this.addressFilter = ''
    this.toggleClearButton()
    this.syncUrl()
    this.renderTable()
    this.addressInputTarget.focus()
  }

  // downloadCsv exports the full ranked miner list (every miner, not the pie's
  // top-25 + "Others" view) as a CSV file, built client-side from this.miners.
  // The address page streams its CSV from the server because its rows are
  // server-paginated; here the whole dataset is already in the browser, so a Blob
  // download avoids a round-trip. The period is baked into the filename so the
  // export is self-describing (spec §6).
  downloadCsv(e) {
    if (e) e.preventDefault()
    if (!this.miners.length) return
    const blob = new Blob([buildCsv(this.miners)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = this.blockRange
      ? `hashrate-shares-${this.blockRange.from}-${this.blockRange.to}.csv`
      : `hashrate-shares-${this.interval}.csv`
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
    Turbo.visit(`/charts?chart=${encodeURIComponent(value)}`)
  }

  async fetchAndRender(seq) {
    let data
    try {
      data = await requestJSON(dataUrl(this.blockRange, this.interval))
    } catch (err) {
      if (seq !== this._reqSeq) return
      console.error('hashrate-shares fetch failed', err)
      this.emptyState = 'error'
      // showEmpty is the single data reset point — it drops miners too.
      this.showEmpty(errorStateMessage(err))
      this.renderPie([])
      return
    }
    if (seq !== this._reqSeq) return
    // A successful fetch is the only thing that clears a sticky invalid/error
    // empty state: whatever the outcome — data, or a genuinely empty period —
    // the message now reflects a real server result.
    this.emptyState = null
    this.miners = (data && data.miners) || []
    this.totals = (data && data.totals) || null
    this.truncated = !!(data && data.truncated)
    this.renderTable()
    this.renderAddressCount()
    this.renderPie(pieSlices(this.miners))
    if (this._pendingAddressScroll) this.scrollToAddress(this._pendingAddressScroll)
    this._pendingAddressScroll = null
  }

  // showEmpty displays a message in the table's empty slot and hides the table
  // furniture (pie, download, truncation note) around it. It also drops any
  // previously loaded data so a failed or invalidated request cannot leave stale
  // rows behind (e.g. a CSV export or a later renderTable reusing the old
  // list). It is the single state reset point for the data-bearing fields —
  // every caller relies on it. The emptyState flavor is NOT reset here: callers
  // set it before showing a sticky message, and only a successful fetch clears
  // it (see renderTable).
  showEmpty(message) {
    this.miners = []
    this.totals = null
    this.truncated = false
    this.emptyTarget.textContent = message
    this.emptyTarget.classList.remove('d-hide')
    this.tableBodyTarget.replaceChildren()
    this.pieWrapTarget.classList.add('d-hide')
    if (this.hasDownloadWrapTarget) this.downloadWrapTarget.classList.add('d-hide')
    this.truncatedNoteTarget.classList.add('d-hide')
    this.updateScrollShadow()
    this.renderAddressCount()
  }

  // renderAddressCount states how many reward addresses the period holds, so a
  // list that is taller than its container isn't mistaken for its visible part.
  // It is fed by totals.addresses — the whole period — and deliberately is NOT
  // refreshed by filterByAddress: spec §3.2 keeps period totals independent of
  // the filtered view, so this must never turn into a count of matching rows.
  // An empty period renders nothing rather than "0": renderTable routes that
  // case to showEmpty, whose message already says there were no PoW rewards.
  renderAddressCount() {
    if (!this.hasAddressCountTarget) return
    const n = this.totals ? this.totals.addresses : 0
    this.addressCountTarget.textContent = n ? `${n} reward address${n === 1 ? '' : 'es'}` : ''
  }

  renderTable() {
    const hasData = this.miners.length > 0
    this.pieWrapTarget.classList.toggle('d-hide', !hasData)
    if (this.hasDownloadWrapTarget) this.downloadWrapTarget.classList.toggle('d-hide', !hasData)

    if (!hasData) {
      // Only the generic empty-period message may be written here. A sticky
      // invalid/error state (bad range input, fetch failure) is left as-is, so
      // an interaction that re-enters renderTable — typing in the address
      // filter — can't relabel "Invalid block range…" as an empty period
      // (spec §3.3 keeps the three messages distinct).
      if (!this.emptyState) {
        this.showEmpty(EMPTY_MESSAGE)
      }
      return
    }

    // The table draws the full ranked list (spec §5.3); the address filter
    // narrows the view without touching ranks or percents.
    const filtered = this.addressFilter
      ? this.miners.filter((m) => m.address.includes(this.addressFilter))
      : this.miners
    this.tableBodyTarget.replaceChildren(...buildRows(this.rowTemplateTarget, filtered))
    this.emptyTarget.classList.toggle('d-hide', filtered.length > 0)
    if (!filtered.length) {
      this.emptyTarget.textContent = `No reward addresses match “${this.addressFilter}”.`
    }
    this.truncatedNoteTarget.classList.toggle('d-hide', !this.truncated)
    this.updateScrollShadow()
  }

  // scrollToAddress brings the row for the address carried by ?address= into
  // view and highlights it (spec §5.3), so a shared link lands the participant
  // on their own row.
  scrollToAddress(address) {
    const rows = [...this.tableBodyTarget.querySelectorAll('tr')]
    const row = rows.find((tr) => {
      const addr = tr.querySelector('[data-type="addr"]')
      return addr && addr.textContent.includes(address)
    })
    if (!row) return
    row.classList.add('hashrate-shares-highlight')
    row.scrollIntoView({ block: 'center' })
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
