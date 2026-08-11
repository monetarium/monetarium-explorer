import { describe, it, expect, vi } from 'vitest'
import { colorForIndex, OTHERS_COLOR } from '../helpers/chart_theme'
// Stub the @hotwired/stimulus import so the controller module loads in jsdom
// and can be constructed directly — Stimulus registration is not involved in
// these tests (same convention as voting_controller.test.js).
vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))
// requestJSON is exercised only by fetchAndRender; vi.hoisted keeps the mock
// factory free of the top-level-variable TDZ (the controller is statically
// imported above).
const { mockRequestJSON } = vi.hoisted(() => ({ mockRequestJSON: vi.fn() }))
vi.mock('../helpers/http', () => ({ requestJSON: mockRequestJSON }))
import {
  swatchColor,
  sliceLabelFits,
  arcPath,
  emptyStateMessage,
  errorStateMessage,
  buildRows,
  pieSlices,
  buildCsv,
  blockRangeFromParams,
  dataUrl,
  syncUrlQuery,
  EMPTY_MESSAGE,
  ERROR_MESSAGE,
  INVALID_MESSAGE,
  PIE,
  PIE_SLICES,
  default as HashrateSharesController
} from './hashrate_shares_controller'

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
    // total = sum 1..28 = 406; others share = 6/406*100 = 1.477.. -> "1.5"
    expect(others.percent).toBe('1.5')
    expect(others.addressCount).toBe(3)
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
      '<td class="text-end mono" data-type="blocks"></td>' +
      '<td class="text-end mono" data-type="minerReward"></td>' +
      '<td class="text-end mono" data-type="fees"></td>' +
      '<td class="position-relative clipboard hashrate-shares-addr" data-type="addr"></td>' +
      '</tr>'
    return t
  }

  const ADDR = 'VsAbCdEfGhIjKlMnOpQrStUvWxYz1234'
  const MINER = {
    rank: 1,
    percent: '91.0',
    address: ADDR,
    count: 9,
    miner_reward: '9000000000',
    fees: '15490'
  }

  // Regression guard for the layout bug: rows must be real <tr>/<td> elements,
  // not loose text/inline nodes.
  it('builds one <tr> with seven <td> cells per miner', () => {
    const tbody = document.createElement('tbody')
    tbody.replaceChildren(
      ...buildRows(rowTemplate(), [
        MINER,
        {
          rank: 2,
          percent: '9.0',
          address: 'VsZZZ',
          count: 1,
          miner_reward: '1000000000',
          fees: '0'
        }
      ])
    )
    expect(tbody.querySelectorAll('tr')).toHaveLength(2)
    expect(tbody.querySelectorAll('td')).toHaveLength(14)
  })

  it('populates rank, percent, blocks, money cells, swatch and a full-address link', () => {
    const tr = buildRows(rowTemplate(), [MINER])[0]
    expect(tr.querySelector('[data-type="rank"]').textContent).toBe('1')
    expect(tr.querySelector('[data-type="percent"]').textContent).toBe('91.0%')
    expect(tr.querySelector('[data-type="blocks"]').textContent).toBe('9')
    // atom strings are formatted client-side as coin strings (spec §4.6)
    expect(tr.querySelector('[data-type="minerReward"]').textContent).toBe('90.00')
    expect(tr.querySelector('[data-type="fees"]').textContent).toBe('0.0001549')
    expect(tr.querySelector('[data-type="swatch"]').style.background).not.toBe('')
    const a = tr.querySelector('a.elidedhash')
    expect(a.getAttribute('href')).toBe(`/address/${ADDR}`)
    // Full address is the actual text content (the CSS elides it responsively);
    // this is what the clipboard control copies.
    expect(a.textContent).toBe(ADDR)
  })

  it('adds a clipboard copy control to each address cell', () => {
    const tr = buildRows(rowTemplate(), [MINER])[0]
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
    const tr = buildRows(rowTemplate(), [
      { rank: 1, percent: '1.0', address: evil, count: 1, miner_reward: '0', fees: '0' }
    ])[0]
    expect(tr.querySelector('b')).toBeNull()
    expect(tr.querySelector('a.elidedhash').textContent).toBe(evil)
  })

  it('returns no rows for an empty miner list', () => {
    expect(buildRows(rowTemplate(), [])).toEqual([])
  })
})

describe('buildCsv', () => {
  it('emits the extended header plus one CRLF-terminated record per miner', () => {
    const csv = buildCsv([
      {
        rank: 1,
        address: 'VsAbc',
        count: 9,
        miner_reward: '9000000000',
        fees: '10000',
        percent: '90.0'
      },
      {
        rank: 2,
        address: 'VsXyz',
        count: 1,
        miner_reward: '1000000000',
        fees: '0',
        percent: '10.0'
      }
    ])
    expect(csv).toBe(
      'rank,reward_address,blocks,miner_reward,fees,percent\r\n' +
        '1,VsAbc,9,90.00,0.0001,90.0\r\n' +
        '2,VsXyz,1,10.00,0.00,10.0\r\n'
    )
  })

  it('quotes and escapes fields containing commas or quotes (RFC 4180)', () => {
    const csv = buildCsv([
      {
        rank: 1,
        address: 'a,b"c',
        count: 1,
        miner_reward: '100000000',
        fees: '0',
        percent: '100.0'
      }
    ])
    expect(csv).toBe(
      'rank,reward_address,blocks,miner_reward,fees,percent\r\n1,"a,b""c",1,1.00,0.00,100.0\r\n'
    )
  })

  it('returns just the header for an empty list (still a valid CSV file)', () => {
    expect(buildCsv([])).toBe('rank,reward_address,blocks,miner_reward,fees,percent\r\n')
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

describe('errorStateMessage', () => {
  it('surfaces the backend 400 JSON error body verbatim', () => {
    const err = new Error(
      '{"error":"Block range too long. Maximum range length is 100000 blocks."}'
    )
    expect(errorStateMessage(err)).toBe(
      'Block range too long. Maximum range length is 100000 blocks.'
    )
  })
  it('falls back to the generic error for a network failure', () => {
    expect(errorStateMessage(new Error('Failed to fetch'))).toBe(ERROR_MESSAGE)
    expect(errorStateMessage(new Error('plain text 500'))).toBe(ERROR_MESSAGE)
  })
})

describe('blockRangeFromParams', () => {
  it('parses a valid range from URL query values', () => {
    expect(blockRangeFromParams('20000', '20001')).toEqual({ from: 20000, to: 20001 })
  })
  it('accepts numeric values', () => {
    expect(blockRangeFromParams(10, 20)).toEqual({ from: 10, to: 20 })
  })
  it('accepts a range starting at block 0 (genesis)', () => {
    expect(blockRangeFromParams('0', '20001')).toEqual({ from: 0, to: 20001 })
  })
  it('returns null when either value is missing', () => {
    expect(blockRangeFromParams(undefined, undefined)).toBeNull()
    expect(blockRangeFromParams('20000', undefined)).toBeNull()
    expect(blockRangeFromParams(undefined, '20001')).toBeNull()
  })
  // Regression: on a clean /hashrate-shares the settings carry null for both
  // params, and Number(null) === 0 — absent values must NOT parse as {0, 0}
  // (which would activate range mode instead of the default Week interval).
  it('returns null when both values are null (clean URL)', () => {
    expect(blockRangeFromParams(null, null)).toBeNull()
    expect(blockRangeFromParams(null, '20001')).toBeNull()
    expect(blockRangeFromParams('20000', null)).toBeNull()
  })
  it('returns null for empty-string params', () => {
    expect(blockRangeFromParams('', '')).toBeNull()
    expect(blockRangeFromParams('', '20001')).toBeNull()
    expect(blockRangeFromParams('20000', '')).toBeNull()
  })
  it('rejects non-numeric values', () => {
    expect(blockRangeFromParams('abc', '20001')).toBeNull()
    expect(blockRangeFromParams('20.5', '20001')).toBeNull()
  })
  it('rejects negative heights', () => {
    expect(blockRangeFromParams('-1', '20001')).toBeNull()
  })
  it('rejects from > to', () => {
    expect(blockRangeFromParams('20001', '20000')).toBeNull()
  })
})

describe('dataUrl', () => {
  it('uses the from/to params for a block range', () => {
    expect(dataUrl({ from: 20000, to: 20001 }, 'custom')).toBe(
      '/hashrate-shares/data?from=20000&to=20001'
    )
  })
  it('falls back to the interval param otherwise', () => {
    expect(dataUrl(null, 'week')).toBe('/hashrate-shares/data?interval=week')
  })
})

describe('syncUrlQuery', () => {
  it('persists a block range as from/to with no interval param', () => {
    expect(syncUrlQuery('custom', { from: 20000, to: 20001 }, '')).toEqual({
      interval: null,
      from: 20000,
      to: 20001,
      address: null
    })
  })
  it('omits the default interval and clears the range params', () => {
    expect(syncUrlQuery('week', null, '')).toEqual({
      interval: null,
      from: null,
      to: null,
      address: null
    })
  })
  it('persists a non-default interval and clears the range params', () => {
    expect(syncUrlQuery('year', null, '')).toEqual({
      interval: 'year',
      from: null,
      to: null,
      address: null
    })
  })
  it('keeps the address filter orthogonal to the period mode', () => {
    expect(syncUrlQuery('year', null, 'VsAbc')).toEqual({
      interval: 'year',
      from: null,
      to: null,
      address: 'VsAbc'
    })
    expect(syncUrlQuery('custom', { from: 1, to: 2 }, 'VsAbc')).toEqual({
      interval: null,
      from: 1,
      to: 2,
      address: 'VsAbc'
    })
  })
})

describe('INVALID_MESSAGE', () => {
  it('is a distinct message from the empty and error states', () => {
    expect(INVALID_MESSAGE).not.toBe(EMPTY_MESSAGE)
    expect(INVALID_MESSAGE).not.toBe(ERROR_MESSAGE)
  })
})

// ---------------------------------------------------------------------------
// Controller behavior: block-range mode state transitions
// ---------------------------------------------------------------------------
// The review-flagged bugs (blank-range handling and the stale-data reset) live
// in stateful controller methods, not the pure functions above, so these tests
// construct the controller directly (Stimulus is stubbed at the top) and drive
// applyBlockRange / showEmpty against real DOM nodes.
describe('controller applyBlockRange and showEmpty', () => {
  // buildCtrl assembles exactly the targets these two methods touch on the
  // paths under test; the rest are left unset because neither method reaches
  // them before the relevant early return.
  function buildCtrl() {
    const ctrl = new HashrateSharesController(document.body)
    ctrl.fromInputTarget = document.createElement('input')
    ctrl.toInputTarget = document.createElement('input')
    ctrl.emptyTarget = document.createElement('div')
    ctrl.tableBodyTarget = document.createElement('tbody')
    ctrl.pieWrapTarget = document.createElement('div')
    ctrl.downloadWrapTarget = document.createElement('div')
    ctrl.hasDownloadWrapTarget = true
    ctrl.truncatedNoteTarget = document.createElement('div')
    ctrl.pieTarget = document.createElement('div')
    ctrl.miners = []
    ctrl.truncated = false
    ctrl.emptyState = null
    ctrl.blockRange = null
    ctrl.interval = 'week'
    ctrl._reqSeq = 0
    return ctrl
  }

  it('leaves the current mode untouched when From and To are both blank (spec 3.1)', () => {
    const ctrl = buildCtrl()
    ctrl.blockRange = { from: 10, to: 20 }
    ctrl.interval = 'custom'
    ctrl.fromInputTarget.value = ''
    ctrl.toInputTarget.value = ''
    ctrl.applyBlockRange()
    expect(ctrl.blockRange).toEqual({ from: 10, to: 20 })
    expect(ctrl.interval).toBe('custom')
    expect(ctrl.emptyTarget.textContent).toBe('')
    expect(ctrl.miners).toEqual([])
  })

  it('rejects a half-filled range as incomplete input', () => {
    const ctrl = buildCtrl()
    ctrl.fromInputTarget.value = '10'
    ctrl.toInputTarget.value = ''
    ctrl.applyBlockRange()
    expect(ctrl.emptyTarget.textContent).toBe(INVALID_MESSAGE)
    expect(ctrl.emptyTarget.classList.contains('d-hide')).toBe(false)
  })

  it('shows the invalid-range message and drops previously loaded rows', () => {
    // The stale-data bug: applying an invalid range while a previous valid
    // period's rows are showing must not leave them behind for renderTable or
    // the CSV export to reuse.
    const ctrl = buildCtrl()
    ctrl.miners = [{ rank: 1, address: 'Vsaaa', count: 7 }]
    ctrl.truncated = true
    ctrl.fromInputTarget.value = '10'
    ctrl.toInputTarget.value = '5' // from > to
    ctrl.applyBlockRange()
    expect(ctrl.emptyTarget.textContent).toBe(INVALID_MESSAGE)
    expect(ctrl.emptyTarget.classList.contains('d-hide')).toBe(false)
    expect(ctrl.emptyState).toBe('invalid')
    expect(ctrl.miners).toEqual([])
    expect(ctrl.truncated).toBe(false)
  })

  it('keeps the invalid-range message when a later renderTable re-enters', () => {
    // The address filter triggers renderTable; with miners cleared, it would
    // otherwise relabel the sticky invalid message as a (valid but) empty
    // period — spec §3.3 keeps the three messages distinct.
    const ctrl = buildCtrl()
    ctrl.fromInputTarget.value = '10'
    ctrl.toInputTarget.value = '5'
    ctrl.applyBlockRange()
    expect(ctrl.emptyTarget.textContent).toBe(INVALID_MESSAGE)
    ctrl.renderTable()
    expect(ctrl.emptyTarget.textContent).toBe(INVALID_MESSAGE)
    expect(ctrl.emptyTarget.classList.contains('d-hide')).toBe(false)
    expect(ctrl.emptyState).toBe('invalid')
  })

  it('shows the generic empty message for a valid empty period', () => {
    const ctrl = buildCtrl()
    ctrl.renderTable()
    expect(ctrl.emptyTarget.textContent).toBe(EMPTY_MESSAGE)
  })

  it('a successful fetch clears a sticky invalid state', async () => {
    const ctrl = buildCtrl()
    ctrl.fromInputTarget.value = '10'
    ctrl.toInputTarget.value = '5'
    ctrl.applyBlockRange()
    expect(ctrl.emptyState).toBe('invalid')
    mockRequestJSON.mockResolvedValueOnce({ miners: [], truncated: false })
    ctrl.blockRange = { from: 10, to: 20 }
    ctrl.interval = 'custom'
    await ctrl.fetchAndRender(ctrl.nextSeq())
    expect(ctrl.emptyState).toBeNull()
    expect(ctrl.emptyTarget.textContent).toBe(EMPTY_MESSAGE)
  })

  it('showEmpty resets data and hides the table furniture', () => {
    const ctrl = buildCtrl()
    ctrl.miners = [{ rank: 1 }]
    ctrl.showEmpty(EMPTY_MESSAGE)
    expect(ctrl.miners).toEqual([])
    expect(ctrl.truncated).toBe(false)
    expect(ctrl.emptyTarget.textContent).toBe(EMPTY_MESSAGE)
    expect(ctrl.emptyTarget.classList.contains('d-hide')).toBe(false)
    expect(ctrl.pieWrapTarget.classList.contains('d-hide')).toBe(true)
    expect(ctrl.downloadWrapTarget.classList.contains('d-hide')).toBe(true)
    expect(ctrl.truncatedNoteTarget.classList.contains('d-hide')).toBe(true)
    expect(ctrl.tableBodyTarget.children.length).toBe(0)
  })

  it('lights the Apply control only while a custom range is active', () => {
    const ctrl = buildCtrl()
    ctrl.intervalOptionTargets = []
    ctrl.blockRangeWrapTarget = document.createElement('div')
    ctrl.applyButtonTarget = document.createElement('li')
    ctrl.interval = 'week'
    ctrl.blockRange = null
    ctrl.syncControlsUI()
    expect(ctrl.applyButtonTarget.classList.contains('active')).toBe(false)
    expect(ctrl.blockRangeWrapTarget.classList.contains('block-range-active')).toBe(false)

    ctrl.interval = 'custom'
    ctrl.blockRange = { from: 10, to: 20 }
    ctrl.syncControlsUI()
    expect(ctrl.applyButtonTarget.classList.contains('active')).toBe(true)
    expect(ctrl.blockRangeWrapTarget.classList.contains('block-range-active')).toBe(true)

    // Switching back to an interval deactivates the Apply control.
    ctrl.interval = 'year'
    ctrl.blockRange = null
    ctrl.syncControlsUI()
    expect(ctrl.applyButtonTarget.classList.contains('active')).toBe(false)
  })

  it('swallows the activating event via preventDefault (keyboard Enter/Space)', () => {
    // Apply is wired to keydown.enter / keydown.space as well as click; Space
    // must not also scroll the page. applyBlockRange calls preventDefault on the
    // event it receives, so a keyboard event reaches the same guard the click
    // path uses. The blank range early-returns before any state changes.
    const ctrl = buildCtrl()
    ctrl.fromInputTarget.value = ''
    ctrl.toInputTarget.value = ''
    const evt = { preventDefault: vi.fn() }
    ctrl.applyBlockRange(evt)
    expect(evt.preventDefault).toHaveBeenCalledTimes(1)
  })
})
