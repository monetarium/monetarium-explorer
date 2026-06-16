import { describe, it, expect } from 'vitest'
import {
  colorForIndex,
  swatchColor,
  sliceLabelFits,
  arcPath,
  emptyStateMessage,
  buildRows,
  pieSlices,
  pageCount,
  clampPage,
  paginate,
  pageItems,
  buildCsv,
  EMPTY_MESSAGE,
  ERROR_MESSAGE,
  OTHERS_COLOR,
  PIE,
  PIE_SLICES,
  PALETTE
} from './hashrate_shares_controller'

describe('colorForIndex', () => {
  it('is deterministic and wraps the palette', () => {
    expect(colorForIndex(0)).toBe(PALETTE[0])
    expect(colorForIndex(1)).toBe(PALETTE[1])
    expect(colorForIndex(PALETTE.length)).toBe(PALETTE[0]) // wraps
  })
})

describe('swatchColor', () => {
  it('colors ranks within the pie by their slice color', () => {
    expect(swatchColor(1)).toBe(colorForIndex(0))
    expect(swatchColor(PIE_SLICES)).toBe(colorForIndex(PIE_SLICES - 1))
  })
  it('greys out ranks beyond the pie (the "Others" bucket)', () => {
    expect(swatchColor(PIE_SLICES + 1)).toBe(OTHERS_COLOR)
    expect(swatchColor(999)).toBe(OTHERS_COLOR)
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

describe('pieSlices', () => {
  function miners(n) {
    return Array.from({ length: n }, (_, i) => ({ rank: i + 1, count: n - i }))
  }

  it('passes through when miner count fits the pie', () => {
    const m = miners(PIE_SLICES)
    expect(pieSlices(m)).toBe(m) // same reference, no aggregation
  })

  it('aggregates the tail beyond the pie into a single "Others" slice', () => {
    const slices = pieSlices(miners(PIE_SLICES + 3))
    expect(slices).toHaveLength(PIE_SLICES + 1)
    const others = slices[slices.length - 1]
    expect(others.isOthers).toBe(true)
    // ranks 26,27,28 had counts 3,2,1 (n - i with n = 28) => 6
    expect(others.count).toBe(6)
  })
})

describe('pageCount', () => {
  it('is the ceiling of total over page size', () => {
    expect(pageCount(0, 25)).toBe(0)
    expect(pageCount(1, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
    expect(pageCount(142, 25)).toBe(6)
  })
})

describe('clampPage', () => {
  it('keeps an in-range page', () => {
    expect(clampPage(3, 6)).toBe(3)
  })
  it('floors below 1 and a non-integer to page 1', () => {
    expect(clampPage(0, 6)).toBe(1)
    expect(clampPage(-2, 6)).toBe(1)
    expect(clampPage(NaN, 6)).toBe(1)
  })
  it('caps above the last page to the last page', () => {
    expect(clampPage(99, 6)).toBe(6)
  })
  it('returns page 1 when there are no pages', () => {
    expect(clampPage(1, 0)).toBe(1)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 142 }, (_, i) => i)
  it('slices the requested page', () => {
    expect(paginate(items, 1, 25)).toEqual(items.slice(0, 25))
    expect(paginate(items, 2, 25)).toEqual(items.slice(25, 50))
    expect(paginate(items, 6, 25)).toEqual(items.slice(125, 142)) // short last page
  })
})

describe('pageItems', () => {
  it('is empty for a single page (no pager needed)', () => {
    expect(pageItems(1, 1)).toEqual([])
  })
  it('windows around the current page with ellipses for gaps', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 'ellipsis', 5])
    expect(pageItems(6, 10)).toEqual([1, 'ellipsis', 5, 6, 7, 'ellipsis', 10])
  })
  it('never emits an ellipsis for an adjacent gap', () => {
    expect(pageItems(2, 3)).toEqual([1, 2, 3])
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
      '<td class="position-relative clipboard hashrate-shares-addr" data-type="addr"></td>' +
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

  it('populates rank, percent, swatch color and a full-address link', () => {
    const tr = buildRows(rowTemplate(), [{ rank: 1, percent: '91.0', address: ADDR, count: 9 }])[0]
    expect(tr.querySelector('[data-type="rank"]').textContent).toBe('1')
    expect(tr.querySelector('[data-type="percent"]').textContent).toBe('91.0%')
    expect(tr.querySelector('[data-type="swatch"]').style.background).not.toBe('')
    const a = tr.querySelector('a.elidedhash')
    expect(a.getAttribute('href')).toBe(`/address/${ADDR}`)
    // Full address is the actual text content (the CSS elides it responsively);
    // this is what the clipboard control copies.
    expect(a.textContent).toBe(ADDR)
  })

  it('adds a clipboard copy control to each address cell', () => {
    const tr = buildRows(rowTemplate(), [{ rank: 1, percent: '91.0', address: ADDR, count: 9 }])[0]
    const addr = tr.querySelector('[data-type="addr"]')
    const copy = addr.querySelector('.monicon-copy')
    expect(copy).not.toBeNull()
    expect(copy.dataset.controller).toBe('clipboard')
    expect(copy.dataset.action).toBe('click->clipboard#copyTextToClipboard')
    // The clipboard controller copies parentNode.textContent.split(' ')[0],
    // so the cell's text must be exactly the address.
    expect(addr.textContent.trim().split(' ')[0]).toBe(ADDR)
  })

  it('never interprets an address as HTML (XSS-safe, no sanitizer needed)', () => {
    const evil = '<b>x</b>'
    const tr = buildRows(rowTemplate(), [{ rank: 1, percent: '1.0', address: evil, count: 1 }])[0]
    expect(tr.querySelector('b')).toBeNull()
    expect(tr.querySelector('a.elidedhash').textContent).toBe(evil)
  })

  it('returns no rows for an empty miner list', () => {
    expect(buildRows(rowTemplate(), [])).toEqual([])
  })
})

describe('buildCsv', () => {
  it('emits a header plus one CRLF-terminated record per miner', () => {
    const csv = buildCsv([
      { rank: 1, address: 'VsAbc', count: 9, percent: '90.0' },
      { rank: 2, address: 'VsXyz', count: 1, percent: '10.0' }
    ])
    expect(csv).toBe(
      'rank,reward_address,reward_tx_count,percent\r\n' +
        '1,VsAbc,9,90.0\r\n' +
        '2,VsXyz,1,10.0\r\n'
    )
  })

  it('quotes and escapes fields containing commas or quotes (RFC 4180)', () => {
    const csv = buildCsv([{ rank: 1, address: 'a,b"c', count: 1, percent: '100.0' }])
    expect(csv).toBe('rank,reward_address,reward_tx_count,percent\r\n1,"a,b""c",1,100.0\r\n')
  })

  it('returns just the header for an empty list (still a valid CSV file)', () => {
    expect(buildCsv([])).toBe('rank,reward_address,reward_tx_count,percent\r\n')
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
