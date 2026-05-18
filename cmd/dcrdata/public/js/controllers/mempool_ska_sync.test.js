/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'

// Mirror of the syncSkaColsIn logic from mempool_controller.js.
// Kept in sync with the controller; the test guards the row-mutation contract.
function activeSkaIds(coinStats) {
  if (!coinStats) return []
  const ids = []
  Object.entries(coinStats).forEach(([k, v]) => {
    const id = parseInt(k, 10)
    if (id === 0 || !v || !v.tx_count || v.tx_count <= 0) return
    ids.push(id)
  })
  ids.sort((a, b) => a - b)
  return ids
}

function syncSkaColsIn(row, coinStats, colFn) {
  Array.from(row.children).forEach((child) => {
    const raw = child.getAttribute('data-coin-type')
    if (raw === null) return
    const id = parseInt(raw, 10)
    if (id !== 0) child.remove()
  })
  activeSkaIds(coinStats).forEach((id) => {
    row.appendChild(colFn(id, coinStats[id]))
  })
}

function fakeColFn(id) {
  const el = document.createElement('div')
  el.setAttribute('data-coin-type', String(id))
  el.dataset.test = 'sync-built'
  el.textContent = `coin ${id}`
  return el
}

function buildRow(staticCols, coinCols) {
  const row = document.createElement('div')
  for (let i = 0; i < staticCols; i++) {
    const el = document.createElement('div')
    el.textContent = `static ${i}`
    row.appendChild(el)
  }
  coinCols.forEach((id) => {
    const el = document.createElement('div')
    el.setAttribute('data-coin-type', String(id))
    el.textContent = `initial coin ${id}`
    row.appendChild(el)
  })
  return row
}

function coinTypes(row) {
  return Array.from(row.children)
    .map((c) => c.getAttribute('data-coin-type'))
    .filter((v) => v !== null)
}

describe('mempool syncSkaColsIn', () => {
  it('removes SKA col when coin_stats drops the SKA entry (block-mined refresh)', () => {
    // Initial: VAR + SKA1 cols rendered (e.g., after newtxs added SKA1 tx).
    const row = buildRow(3, [0, 1])
    expect(coinTypes(row)).toEqual(['0', '1'])

    // Fresh mempool after block: only VAR remains in coin_stats.
    const coinStats = {
      0: { tx_count: 5, regular_count: 1, amount: '100', regular_amount: '50' }
    }
    syncSkaColsIn(row, coinStats, fakeColFn)

    expect(coinTypes(row)).toEqual(['0'])
    // Static children preserved.
    expect(row.children.length).toBe(4)
  })

  it('adds SKA col when newly active in coin_stats', () => {
    const row = buildRow(3, [0])
    const coinStats = {
      0: { tx_count: 5, regular_count: 1 },
      1: { tx_count: 1, regular_count: 1, amount: '999', regular_amount: '999' }
    }
    syncSkaColsIn(row, coinStats, fakeColFn)
    expect(coinTypes(row)).toEqual(['0', '1'])
    // The SKA1 col should be the JS-built one, not the server-rendered initial.
    const ska1 = row.querySelector('[data-coin-type="1"]')
    expect(ska1.dataset.test).toBe('sync-built')
  })

  it('removes SKA col when tx_count drops to 0', () => {
    const row = buildRow(3, [0, 2])
    const coinStats = {
      0: { tx_count: 5 },
      2: { tx_count: 0 } // dropped to 0 → should be removed
    }
    syncSkaColsIn(row, coinStats, fakeColFn)
    expect(coinTypes(row)).toEqual(['0'])
  })

  it('replaces JS-built SKA col on subsequent sync (data-coin-type preserved via setAttribute)', () => {
    // Simulates: initial server-rendered → first sync replaces → second sync
    // must still find and remove the JS-built col.
    const row = buildRow(3, [0])
    // First sync inserts SKA1.
    syncSkaColsIn(
      row,
      { 0: { tx_count: 1 }, 1: { tx_count: 1, amount: '1', regular_amount: '1' } },
      fakeColFn
    )
    expect(coinTypes(row)).toEqual(['0', '1'])
    // Second sync (block mined): SKA1 absent.
    syncSkaColsIn(row, { 0: { tx_count: 1 } }, fakeColFn)
    expect(coinTypes(row)).toEqual(['0'])
  })

  it('handles coin_stats with only VAR by removing all SKA cols', () => {
    const row = buildRow(3, [0, 1, 2, 3])
    syncSkaColsIn(row, { 0: { tx_count: 1 } }, fakeColFn)
    expect(coinTypes(row)).toEqual(['0'])
  })

  it('sorts inserted SKA cols ascending by id regardless of object insertion order', () => {
    const row = buildRow(3, [0])
    const coinStats = {
      0: { tx_count: 1 },
      3: { tx_count: 1, amount: '3', regular_amount: '3' },
      1: { tx_count: 1, amount: '1', regular_amount: '1' },
      2: { tx_count: 1, amount: '2', regular_amount: '2' }
    }
    syncSkaColsIn(row, coinStats, fakeColFn)
    expect(coinTypes(row)).toEqual(['0', '1', '2', '3'])
  })
})
