import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../services/event_bus_service', () => ({
  default: { on: vi.fn(), off: vi.fn() }
}))

const wsRegistered = {}
const wsSend = vi.fn()

vi.mock('../services/messagesocket_service', () => ({
  default: {
    registerEvtHandler: vi.fn((event, handler) => {
      const unsub = vi.fn()
      ;(wsRegistered[event] = wsRegistered[event] || []).push({ handler, unsub })
      return unsub
    }),
    deregisterEvtHandler: vi.fn(),
    deregisterEvtHandlers: vi.fn(),
    send: wsSend
  }
}))

// Named exports the new controller must expose for unit testing the
// DOM-building helpers in isolation from Stimulus.
const mod = await import('./visualBlocks_controller.js')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleCoinFills = [
  {
    symbol: 'VAR',
    gq_fill_ratio: 0.5,
    extra_fill_ratio: 0,
    overflow_fill_ratio: 0,
    gq_position_ratio: 0.1,
    status: 'ok',
    pct_of_tc: 5.0,
    is_overflow: false
  },
  {
    symbol: 'SKA1',
    gq_fill_ratio: 0.25,
    extra_fill_ratio: 0,
    overflow_fill_ratio: 0,
    gq_position_ratio: 0.9,
    status: 'ok',
    pct_of_tc: 22.5,
    is_overflow: false
  }
]

const sampleRegularCoinCounts = [
  { coin_type: 0, symbol: 'VAR', count: 7 },
  { coin_type: 1, symbol: 'SKA1', count: 3 }
]

function makeVote(voted, voteValid, txID = 'votehash') {
  return { Voted: voted, VoteValid: voteValid, TxID: txID, Total: 1 }
}

function makeMempoolFixture() {
  return {
    Time: 1700000000,
    TotalSize: 12345,
    MaxBlockSize: 393216,
    TotalFillRatio: 0.05,
    ActiveSKACount: 1,
    CoinFills: sampleCoinFills,
    CoinStats: {
      0: {
        tx_count: 8,
        regular_count: 5,
        ticket_count: 2,
        vote_count: 1,
        revoke_count: 0,
        size: 4000
      },
      1: {
        tx_count: 3,
        regular_count: 3,
        ticket_count: 0,
        vote_count: 0,
        revoke_count: 0,
        size: 1500
      }
    },
    Votes: [makeVote(true, true), makeVote(true, false), makeVote(false, false)],
    Tickets: [{ TxID: 'tickethash', Total: 100, VoutCount: 4, VinCount: 1 }],
    Revocations: [{ TxID: 'revhash', Total: 100, VoutCount: 1, VinCount: 1 }],
    Transactions: [{ TxID: 'txhash', Total: 50, VoutCount: 2, VinCount: 1, Fees: 0.001 }]
  }
}

function makeBlockFixture() {
  return {
    Height: 1234,
    Time: { UNIX: 1700000100 },
    Size: 15000,
    FormattedBytes: '15 kB',
    TotalSent: 100,
    MiningFee: 0.001,
    MaxBlockSize: 393216,
    TotalFillRatio: 15000 / 393216,
    ActiveSKACount: 1,
    CoinFills: sampleCoinFills,
    RegularCoinCounts: sampleRegularCoinCounts,
    Votes: [makeVote(true, true), makeVote(true, false), makeVote(false, false)],
    Tickets: [{ TxID: 'tickethash', Total: 100, VoutCount: 4, VinCount: 1 }],
    Revocations: [],
    Tx: [
      { TxID: 'txhash', Total: 50, VoutCount: 2, VinCount: 1, Fees: 0.001, Coinbase: false },
      { TxID: 'coinbasehash', Total: 5, VoutCount: 1, VinCount: 0, Coinbase: true }
    ]
  }
}

// ---------------------------------------------------------------------------
// Mempool tile
// ---------------------------------------------------------------------------

describe('makeMempoolBlock', () => {
  it('renders tile size + fill-ratio percent in header (no DCR label)', () => {
    const tile = mod.makeMempoolBlock(makeMempoolFixture())

    const size = tile.querySelector('.block-info .size')
    expect(size).toBeTruthy()
    expect(size.textContent).toContain('kB')

    const pct = tile.querySelector('.block-info .size-pct')
    expect(pct).toBeTruthy()
    expect(pct.textContent).toMatch(/%/)

    expect(tile.outerHTML).not.toMatch(/\bDCR\b/)
  })

  it('does not render the legacy rewards row or per-tx transactions row', () => {
    const tile = mod.makeMempoolBlock(makeMempoolFixture())
    expect(tile.querySelector('.block-rewards')).toBeNull()
    expect(tile.querySelector('.block-transactions')).toBeNull()
    expect(tile.querySelector('.block-tx')).toBeNull()
    expect(tile.querySelector('.fund')).toBeNull()
    expect(tile.querySelector('.pow')).toBeNull()
    expect(tile.querySelector('.pos')).toBeNull()
    expect(tile.querySelector('.fees')).toBeNull()
  })

  it('renders three vote states (yes/no/skip) with coin VAR in title', () => {
    const tile = mod.makeMempoolBlock(makeMempoolFixture())
    const votes = tile.querySelectorAll('.block-votes > span')
    // 3 actual votes + 2 empty slots
    expect(votes.length).toBe(5)

    expect(votes[0].classList.contains('vote-yes')).toBe(true)
    expect(votes[1].classList.contains('vote-no')).toBe(true)
    expect(votes[2].classList.contains('vote-skip')).toBe(true)
    expect(votes[3].classList.contains('vote-yes')).toBe(false)
    expect(votes[3].classList.contains('vote-no')).toBe(false)
    expect(votes[3].classList.contains('vote-skip')).toBe(false)

    const title = JSON.parse(votes[0].getAttribute('title'))
    expect(title.coin).toBe('VAR')
    expect(title.object).toBe('Vote')
    expect('voted' in title).toBe(true)
    expect('voteValid' in title).toBe(true)
  })

  it('renders indicator-fill with one TOTAL bar plus one fill-bar per CoinFills entry', () => {
    const tile = mod.makeMempoolBlock(makeMempoolFixture())
    const indicator = tile.querySelector('.indicator-fill')
    expect(indicator).toBeTruthy()
    expect(indicator.querySelectorAll('.total-bar').length).toBe(1)

    const bars = indicator.querySelectorAll('.fill-bar')
    expect(bars.length).toBe(sampleCoinFills.length)
    expect(bars[0].dataset.coin).toBe('VAR')
    expect(bars[1].dataset.coin).toBe('SKA1')
  })

  it('puts coin + tx-count in fill-bar tooltip JSON (count from CoinStats.regular_count)', () => {
    const tile = mod.makeMempoolBlock(makeMempoolFixture())
    const bars = tile.querySelectorAll('.fill-bar')
    const varTitle = JSON.parse(bars[0].getAttribute('title'))
    expect(varTitle.object).toBe('FillBar')
    expect(varTitle.coin).toBe('VAR')
    expect(varTitle.txCount).toBe('5')

    const skaTitle = JSON.parse(bars[1].getAttribute('title'))
    expect(skaTitle.coin).toBe('SKA1')
    expect(skaTitle.txCount).toBe('3')
  })

  it('ticket title carries coin: "VAR"', () => {
    const tile = mod.makeMempoolBlock(makeMempoolFixture())
    const ticket = tile.querySelector('.block-ticket')
    expect(ticket).toBeTruthy()
    const t = JSON.parse(ticket.getAttribute('title'))
    expect(t.coin).toBe('VAR')
    expect(t.object).toBe('Ticket')
  })
})

// ---------------------------------------------------------------------------
// Block tile (from WS payload)
// ---------------------------------------------------------------------------

describe('newBlockHtmlElement', () => {
  it('renders block-size header + percent (no DCR label)', () => {
    const tile = mod.newBlockHtmlElement(makeBlockFixture())

    const size = tile.querySelector('.block-info .size')
    expect(size).toBeTruthy()
    expect(size.textContent).toContain('kB')

    expect(tile.outerHTML).not.toMatch(/\bDCR\b/)
  })

  it('omits the rewards row and the per-tx transactions row', () => {
    const tile = mod.newBlockHtmlElement(makeBlockFixture())
    expect(tile.querySelector('.block-rewards')).toBeNull()
    expect(tile.querySelector('.block-transactions')).toBeNull()
    expect(tile.querySelector('.block-tx')).toBeNull()
    expect(tile.querySelector('.fund')).toBeNull()
  })

  it('renders indicator-fill bars + TOTAL with txCount from RegularCoinCounts', () => {
    const tile = mod.newBlockHtmlElement(makeBlockFixture())
    const indicator = tile.querySelector('.indicator-fill')
    expect(indicator).toBeTruthy()
    expect(indicator.querySelectorAll('.total-bar').length).toBe(1)

    const totalTitle = JSON.parse(indicator.querySelector('.total-bar').getAttribute('title'))
    expect(totalTitle.coin).toBe('TOTAL')
    expect(totalTitle.txCount).toBe('10') // 7 VAR + 3 SKA1

    const varBar = indicator.querySelector('.fill-bar[data-coin="VAR"]')
    expect(varBar).toBeTruthy()
    const varTitle = JSON.parse(varBar.getAttribute('title'))
    expect(varTitle.txCount).toBe('7')
  })

  it('vote row uses three CSS classes by Voted/VoteValid', () => {
    const tile = mod.newBlockHtmlElement(makeBlockFixture())
    const votes = tile.querySelectorAll('.block-votes > span')
    expect(votes[0].classList.contains('vote-yes')).toBe(true)
    expect(votes[1].classList.contains('vote-no')).toBe(true)
    expect(votes[2].classList.contains('vote-skip')).toBe(true)
  })

  it('block-rows contains votes, tickets and indicator-fill in that order (no transactions row)', () => {
    const tile = mod.newBlockHtmlElement(makeBlockFixture())
    const rows = tile.querySelectorAll('.block-rows > *')
    expect(rows.length).toBe(3)
    expect(rows[0].classList.contains('block-votes')).toBe(true)
    expect(rows[1].classList.contains('block-tickets')).toBe(true)
    expect(rows[2].classList.contains('indicator-fill')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Wire-shape regression — BlockBasic has lowercase JSON tags so the WS
// payload exposes block.height / block.time / block.size /
// block.formatted_bytes, not the PascalCase Go field names. A normalisation
// step must accept the wire shape unchanged. This locks in the fix for the
// "undefined / NaNs ago" tile bug observed at first launch.
// ---------------------------------------------------------------------------

describe('normaliseWsBlock (WS wire shape regression)', () => {
  it('reads height/time/size/formatted_bytes from snake-case JSON tags (BlockBasic embed)', () => {
    // Locks in the fix for the "undefined / NaNs ago" tile bug. The WS
    // BlockInfo payload exposes BlockBasic fields via lowercase JSON tags
    // (height, time, size, formatted_bytes). Reading PascalCase
    // block.Height directly yields undefined.
    const tile = mod.normaliseWsBlock({
      height: 7777,
      time: '2026-01-01T00:00:00Z',
      size: 4096,
      formatted_bytes: '4.1 kB',
      Votes: [],
      Tickets: [],
      Revs: [],
      coin_fills: sampleCoinFills,
      regular_coin_counts: sampleRegularCoinCounts,
      total_fill_ratio: 0.5,
      max_block_size: 393216,
      active_ska_count: 1
    })
    expect(tile.Height).toBe(7777)
    expect(tile.Time).toBe('2026-01-01T00:00:00Z')
    expect(tile.Size).toBe(4096)
    expect(tile.FormattedBytes).toBe('4.1 kB')
    expect(tile.CoinFills).toEqual(sampleCoinFills)
    expect(tile.RegularCoinCounts).toEqual(sampleRegularCoinCounts)
    expect(tile.TotalFillRatio).toBe(0.5)
    expect(tile.MaxBlockSize).toBe(393216)
  })

  it('normalises nested vote records from snake-case (voted/vote_valid) to PascalCase', () => {
    const tile = mod.normaliseWsBlock({
      height: 1,
      time: '2026-01-01T00:00:00Z',
      size: 1,
      formatted_bytes: '1 B',
      Votes: [
        { TxID: 'a', Total: 1, voted: true, vote_valid: true, vin_count: 1, vout_count: 2 },
        { TxID: 'b', Total: 1, voted: false, vote_valid: false }
      ],
      Tickets: [],
      Revs: []
    })
    expect(tile.Votes[0].Voted).toBe(true)
    expect(tile.Votes[0].VoteValid).toBe(true)
    expect(tile.Votes[0].VinCount).toBe(1)
    expect(tile.Votes[0].VoutCount).toBe(2)
    expect(tile.Votes[1].Voted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Reconnect resync — after a dropped socket comes back, the controller must
// re-request the trimmed mempool it draws from, and clean up its handler.
// ---------------------------------------------------------------------------

describe('visualBlocks reconnect resync', () => {
  beforeEach(() => {
    for (const key of Object.keys(wsRegistered)) delete wsRegistered[key]
    wsSend.mockClear()
  })

  it("re-requests the trimmed mempool on 'reconnect'", () => {
    const c = new mod.default()
    c.connect()

    expect(wsRegistered.reconnect).toHaveLength(1)
    wsRegistered.reconnect[0].handler()

    expect(wsSend).toHaveBeenCalledWith('getmempooltrimmed', '')
  })

  it("removes its own 'reconnect' handler on disconnect", () => {
    const c = new mod.default()
    c.connect()
    c.disconnect()

    expect(wsRegistered.reconnect[0].unsub).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Controller method integration — DOM mutation from mempool/block events
// ---------------------------------------------------------------------------

describe('controller mempool-tile lifecycle', () => {
  let c
  let boxTarget

  beforeEach(() => {
    c = new mod.default()
    boxTarget = document.createElement('div')
    c.boxTarget = boxTarget
    c.setupTooltips = vi.fn()

    // Initial state: mempool tile + 3 block tiles
    const mempoolEl = document.createElement('div')
    mempoolEl.className = 'block visible'
    mempoolEl.setAttribute('data-role', 'mempool-tile')
    mempoolEl.setAttribute('data-visualBlocks-target', 'block')
    boxTarget.appendChild(mempoolEl)

    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div')
      el.className = 'block visible'
      el.setAttribute('data-visualBlocks-target', 'block')
      el.textContent = `block-${i}`
      boxTarget.appendChild(el)
    }
  })

  it('handleMempoolUpdate replaces the mempool tile in place, preserving count', () => {
    c.handleMempoolUpdate(JSON.stringify(makeMempoolFixture()))

    const mempoolTiles = boxTarget.querySelectorAll('[data-role="mempool-tile"]')
    expect(mempoolTiles).toHaveLength(1)
    expect(mempoolTiles[0]).toBe(boxTarget.firstChild)
    expect(boxTarget.children).toHaveLength(4)
  })

  it('_handleVisualBlocksUpdate inserts new block after mempool tile, trims last', () => {
    c._handleVisualBlocksUpdate({
      block: {
        height: 100,
        time: '2026-01-01T00:00:00Z',
        size: 4096,
        formatted_bytes: '4.1 kB',
        Votes: [],
        Tickets: [],
        Revs: []
      }
    })

    const mempoolTiles = boxTarget.querySelectorAll('[data-role="mempool-tile"]')
    expect(mempoolTiles).toHaveLength(1)
    expect(mempoolTiles[0]).toBe(boxTarget.firstChild)
    expect(boxTarget.children).toHaveLength(4)
    // Second child should be the new block tile (not block-0)
    expect(boxTarget.children[1].textContent).not.toBe('block-0')
  })

  it('mempool tile remains singular after both mempool and block updates', () => {
    c.handleMempoolUpdate(JSON.stringify(makeMempoolFixture()))
    c._handleVisualBlocksUpdate({
      block: {
        height: 101,
        time: '2026-01-01T00:00:01Z',
        size: 2048,
        formatted_bytes: '2.0 kB',
        Votes: [],
        Tickets: [],
        Revs: []
      }
    })

    const mempoolTiles = boxTarget.querySelectorAll('[data-role="mempool-tile"]')
    expect(mempoolTiles).toHaveLength(1)
    expect(boxTarget.children).toHaveLength(4)
    expect(mempoolTiles[0]).toBe(boxTarget.firstChild)
  })

  it('_handleVisualBlocksUpdate with empty boxTarget does not throw', () => {
    const emptyBox = document.createElement('div')
    c.boxTarget = emptyBox
    expect(() =>
      c._handleVisualBlocksUpdate({
        block: {
          height: 1,
          time: '2026-01-01T00:00:00Z',
          size: 1,
          formatted_bytes: '1 B',
          Votes: [],
          Tickets: [],
          Revs: []
        }
      })
    ).not.toThrow()
    expect(emptyBox.children).toHaveLength(0)
  })
})
