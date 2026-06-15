import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'

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

// Minimum slice sweep (radians) for a rank number to fit inside the slice.
export const MIN_LABEL_SWEEP = 0.18 // ~10.3 degrees

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

// buildRows clones the row <template> once per miner and fills each cell via
// textContent / attributes, returning the resulting <tr> elements.
//
// No HTML is parsed from the data, so untrusted values (reward addresses) stay
// inert without a sanitizer — textContent never interprets markup. Cloning a
// <template> also preserves the <tr>/<td> structure, which a row string fed
// through innerHTML would lose (the HTML parser drops bare table tags outside a
// table context).
export function buildRows(rowTemplate, miners) {
  return miners.map((m, i) => {
    const row = document.importNode(rowTemplate.content, true).querySelector('tr')
    row.querySelector('[data-type="rank"]').textContent = m.isOthers ? '' : String(m.rank)
    row.querySelector('[data-type="swatch"]').style.background = m.isOthers
      ? OTHERS_COLOR
      : colorForIndex(i)
    row.querySelector('[data-type="percent"]').textContent = `${m.percent}%`

    const addr = row.querySelector('[data-type="addr"]')
    if (m.isOthers) {
      const span = document.createElement('span')
      span.className = 'text-secondary'
      span.textContent = 'Others'
      addr.appendChild(span)
    } else {
      const link = document.createElement('a')
      link.className = 'mono'
      link.href = `/address/${m.address}`
      link.textContent = middleTruncate(m.address)
      addr.appendChild(link)
    }
    return row
  })
}

export function sliceLabelFits(sweepRadians) {
  return sweepRadians >= MIN_LABEL_SWEEP
}

export function middleTruncate(s, head = 8, tail = 6) {
  if (typeof s !== 'string' || s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
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
  static targets = ['pie', 'tableBody', 'rowTemplate', 'intervalOption', 'empty', 'pieWrap']

  connect() {
    this.interval = 'all'
    this._reqSeq = (this._reqSeq || 0) + 1
    this.fetchAndRender(this._reqSeq)
  }

  setInterval(e) {
    const option = e.currentTarget.dataset.option
    if (option === this.interval) return
    this.interval = option
    this.intervalOptionTargets.forEach((el) => {
      el.classList.toggle('active', el.dataset.option === option)
    })
    this._reqSeq = (this._reqSeq || 0) + 1
    this.fetchAndRender(this._reqSeq)
  }

  // Navigate to /charts for any non-hashrate-shares selection (parity with the
  // CHART <select> on /charts).
  selectChart(e) {
    const value = e.currentTarget.value
    if (value === 'hashrate-shares') return
    window.location.assign(`/charts?chart=${encodeURIComponent(value)}`)
  }

  async fetchAndRender(seq) {
    let data
    try {
      data = await requestJSON(`/hashrate-shares/data?interval=${this.interval}`)
    } catch (err) {
      if (seq !== this._reqSeq) return
      console.error('hashrate-shares fetch failed', err)
      this.renderTable([], true)
      this.renderPie([])
      return
    }
    if (seq !== this._reqSeq) return
    const miners = (data && data.miners) || []
    this.renderTable(miners)
    this.renderPie(miners)
  }

  renderTable(miners, isError = false) {
    const empty = !miners.length
    this.emptyTarget.classList.toggle('d-hide', !empty)
    this.pieWrapTarget.classList.toggle('d-hide', empty)
    if (empty) this.emptyTarget.textContent = emptyStateMessage(isError)
    this.tableBodyTarget.replaceChildren(...buildRows(this.rowTemplateTarget, miners))
  }

  renderPie(miners) {
    const svg = this.pieTarget
    svg.innerHTML = ''
    if (!miners.length) return

    const total = miners.reduce((acc, m) => acc + Number(m.count), 0)
    if (total <= 0) return

    // Single slice cannot be drawn as a wedge arc — use a full circle.
    if (miners.length === 1) {
      const c = document.createElementNS(SVGNS, 'circle')
      c.setAttribute('cx', PIE.cx)
      c.setAttribute('cy', PIE.cy)
      c.setAttribute('r', PIE.r)
      c.setAttribute('fill', colorForIndex(0))
      svg.appendChild(c)
      return
    }

    let angle = -Math.PI / 2 // start at 12 o'clock
    miners.forEach((m, i) => {
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
