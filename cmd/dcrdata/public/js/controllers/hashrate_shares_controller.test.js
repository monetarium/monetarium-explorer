import { describe, it, expect } from 'vitest'
import {
  middleTruncate,
  colorForIndex,
  sliceLabelFits,
  arcPath,
  emptyStateMessage,
  buildRows,
  EMPTY_MESSAGE,
  ERROR_MESSAGE,
  PIE,
  PALETTE
} from './hashrate_shares_controller'

describe('middleTruncate', () => {
  it('truncates the middle of a long address', () => {
    // head 8 = "VsAbCdEf", tail 6 = "Yz1234"
    expect(middleTruncate('VsAbCdEfGhIjKlMnOpQrStUvWxYz1234', 8, 6)).toBe('VsAbCdEf…Yz1234')
  })
  it('keeps short strings unchanged', () => {
    expect(middleTruncate('short', 8, 6)).toBe('short')
  })
})

describe('colorForIndex', () => {
  it('is deterministic and wraps the palette', () => {
    expect(colorForIndex(0)).toBe(PALETTE[0])
    expect(colorForIndex(1)).toBe(PALETTE[1])
    expect(colorForIndex(PALETTE.length)).toBe(PALETTE[0]) // wraps
  })
})

describe('sliceLabelFits', () => {
  it('numbers a large slice', () => {
    expect(sliceLabelFits(Math.PI / 2)).toBe(true) // 90deg
  })
  it('skips a sliver', () => {
    expect(sliceLabelFits(0.02)).toBe(false) // ~1.1deg
  })
})

describe('arcPath', () => {
  it('produces a wedge path string from center', () => {
    const d = arcPath(0, Math.PI / 2)
    expect(d.startsWith(`M ${PIE.cx} ${PIE.cy}`)).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })
  it('sets the large-arc flag based on sweep', () => {
    // path arc segment is "A 165 165 0 <largeArc> 1 ..." (PIE.r === 165)
    expect(arcPath(0, Math.PI / 2)).toContain('165 0 0 1') // <180deg -> large-arc 0
    expect(arcPath(0, (3 * Math.PI) / 2)).toContain('165 0 1 1') // >180deg -> large-arc 1
  })
})

describe('buildRows', () => {
  // Mirrors the <template> in hashrate_shares.tmpl that the controller clones.
  function rowTemplate() {
    const t = document.createElement('template')
    t.innerHTML =
      '<tr>' +
      '<td class="text-end" data-type="rank"></td>' +
      '<td><span class="hashrate-shares-swatch" data-type="swatch"></span></td>' +
      '<td class="text-end mono" data-type="percent"></td>' +
      '<td class="break-word" data-type="addr"></td>' +
      '</tr>'
    return t
  }

  const ADDR = 'VsAbCdEfGhIjKlMnOpQrStUvWxYz1234'

  // Regression guard for the layout bug: rows must be real <tr>/<td> elements,
  // not loose text/inline nodes.
  it('builds one <tr> with four <td> cells per miner', () => {
    const tbody = document.createElement('tbody')
    tbody.replaceChildren(
      ...buildRows(rowTemplate(), [
        { rank: 1, percent: '91.0', address: ADDR, count: 9 },
        { rank: 2, percent: '9.0', address: 'VsZZZ', count: 1 }
      ])
    )
    expect(tbody.querySelectorAll('tr')).toHaveLength(2)
    expect(tbody.querySelectorAll('td')).toHaveLength(8)
  })

  it('populates rank, percent, swatch color and a linked address', () => {
    const tr = buildRows(rowTemplate(), [{ rank: 1, percent: '91.0', address: ADDR, count: 9 }])[0]
    expect(tr.querySelector('[data-type="rank"]').textContent).toBe('1')
    expect(tr.querySelector('[data-type="percent"]').textContent).toBe('91.0%')
    expect(tr.querySelector('[data-type="swatch"]').style.background).not.toBe('')
    const a = tr.querySelector('a')
    expect(a.getAttribute('href')).toBe(`/address/${ADDR}`)
    expect(a.textContent).toBe(middleTruncate(ADDR))
  })

  it('renders the Others bucket as plain text with no rank or link', () => {
    const tr = buildRows(rowTemplate(), [{ isOthers: true, percent: '5.0', count: 1 }])[0]
    expect(tr.querySelector('[data-type="rank"]').textContent).toBe('')
    expect(tr.querySelector('a')).toBeNull()
    expect(tr.querySelector('[data-type="addr"]').textContent).toBe('Others')
  })

  it('never interprets an address as HTML (XSS-safe, no sanitizer needed)', () => {
    const evil = '<b>x</b>'
    const tr = buildRows(rowTemplate(), [{ rank: 1, percent: '1.0', address: evil, count: 1 }])[0]
    expect(tr.querySelector('b')).toBeNull()
    expect(tr.querySelector('a').textContent).toBe(evil)
  })

  it('returns no rows for an empty miner list', () => {
    expect(buildRows(rowTemplate(), [])).toEqual([])
  })
})

describe('emptyStateMessage', () => {
  it('reports an empty period when the fetch succeeded with no miners', () => {
    expect(emptyStateMessage(false)).toBe('No PoW Reward transactions in the selected period.')
  })
  it('reports a distinct failure message when the fetch errored', () => {
    expect(emptyStateMessage(true)).toBe('Could not load hashrate shares. Please try again.')
  })
  it('never conflates the empty period and the fetch-error states', () => {
    expect(ERROR_MESSAGE).not.toBe(EMPTY_MESSAGE)
  })
})
