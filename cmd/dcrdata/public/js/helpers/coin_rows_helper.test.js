import { describe, expect, it } from 'vitest'
import { coinRowsToSKAData, formatSKAAmountCell } from './coin_rows_helper'
import humanize from './humanize_helper'

describe('formatSKAAmountCell', () => {
  // Six scenarios from the spec, mirrored in Go's TestFormatSKAAmountCell.

  it('scenario 1 (no SKA issued): subRows.length === 0 → "—"', () =>
    expect(formatSKAAmountCell([])).toBe('—'))

  it('scenario 2 (SKA1 issued, not in block — zero-value row): renders "0"', () =>
    expect(formatSKAAmountCell([{ amount: '0' }])).toBe('0'))

  it('scenario 3 (SKA1 present): renders the formatted amount', () => {
    const amount = humanize.formatCoinAtoms('1230000000000000000', 1) // "1.23"
    expect(formatSKAAmountCell([{ amount }])).toBe(amount)
  })

  it('scenario 3 (SKA1 present, 12,500 SKA): renders "12.5k"', () => {
    const amount = humanize.formatCoinAtoms('12500000000000000000000', 1)
    expect(formatSKAAmountCell([{ amount }])).toBe('12.5k')
  })

  it('scenario 4 (SKA1 & SKA2 issued, neither in block): "Σ 2"', () =>
    expect(formatSKAAmountCell([{ amount: '0' }, { amount: '0' }])).toBe('Σ 2'))

  it('scenario 5 (SKA1 & SKA2 issued, one present): "Σ 2"', () =>
    expect(
      formatSKAAmountCell([
        { amount: humanize.formatCoinAtoms('1000000000000000000', 1) },
        { amount: '0' }
      ])
    ).toBe('Σ 2'))

  it('scenario 6 (SKA1 & SKA2 issued, both present): "Σ 2"', () =>
    expect(
      formatSKAAmountCell([
        { amount: humanize.formatCoinAtoms('1000000000000000000', 1) },
        { amount: humanize.formatCoinAtoms('2000000000000000000', 2) }
      ])
    ).toBe('Σ 2'))

  it('many SKA types: "Σ 5"', () =>
    expect(formatSKAAmountCell(Array(5).fill({ amount: '0' }))).toBe('Σ 5'))
})

describe('coinRowsToSKAData → skaAmount', () => {
  // End-to-end: the cell text the WebSocket controllers paint into the row.

  it('block with no coin_rows → "—"', () => {
    const block = { tx: 1, total: 0.5, size: 200, votes: 0, tickets: 0, revocations: 0 }
    expect(coinRowsToSKAData(block).skaAmount).toBe('—')
  })

  it('block with coin_rows but VAR only → "—"', () => {
    const block = {
      tx: 1,
      total: 0.5,
      size: 200,
      votes: 0,
      tickets: 0,
      revocations: 0,
      coin_rows: [{ coin_type: 0, symbol: 'VAR', tx_count: 1, amount: '100000000', size: 200 }]
    }
    expect(coinRowsToSKAData(block).skaAmount).toBe('—')
  })

  it('single SKA row with zero amount → "0"', () => {
    const block = {
      tx: 0,
      total: 0,
      size: 0,
      votes: 0,
      tickets: 0,
      revocations: 0,
      coin_rows: [{ coin_type: 1, symbol: 'SKA1', tx_count: 0, amount: '0', size: 0 }]
    }
    expect(coinRowsToSKAData(block).skaAmount).toBe('0')
  })

  it('single SKA row with 1.23 SKA → "1.23"', () => {
    const block = {
      tx: 0,
      total: 0,
      size: 0,
      votes: 0,
      tickets: 0,
      revocations: 0,
      coin_rows: [
        { coin_type: 1, symbol: 'SKA1', tx_count: 1, amount: '1230000000000000000', size: 100 }
      ]
    }
    expect(coinRowsToSKAData(block).skaAmount).toBe('1.23')
  })

  it('two SKA rows (both zero-value) → "Σ 2"', () => {
    const block = {
      tx: 0,
      total: 0,
      size: 0,
      votes: 0,
      tickets: 0,
      revocations: 0,
      coin_rows: [
        { coin_type: 1, symbol: 'SKA1', tx_count: 0, amount: '0', size: 0 },
        { coin_type: 2, symbol: 'SKA2', tx_count: 0, amount: '0', size: 0 }
      ]
    }
    expect(coinRowsToSKAData(block).skaAmount).toBe('Σ 2')
  })

  it('two SKA rows, one with real activity → "Σ 2"', () => {
    const block = {
      tx: 0,
      total: 0,
      size: 0,
      votes: 0,
      tickets: 0,
      revocations: 0,
      coin_rows: [
        { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 100 },
        { coin_type: 2, symbol: 'SKA2', tx_count: 0, amount: '0', size: 0 }
      ]
    }
    expect(coinRowsToSKAData(block).skaAmount).toBe('Σ 2')
  })

  it('three SKA rows → "Σ 3"', () => {
    const block = {
      tx: 0,
      total: 0,
      size: 0,
      votes: 0,
      tickets: 0,
      revocations: 0,
      coin_rows: [
        { coin_type: 1, symbol: 'SKA1', tx_count: 1, amount: '1', size: 1 },
        { coin_type: 2, symbol: 'SKA2', tx_count: 1, amount: '2', size: 1 },
        { coin_type: 3, symbol: 'SKA3', tx_count: 1, amount: '3', size: 1 }
      ]
    }
    expect(coinRowsToSKAData(block).skaAmount).toBe('Σ 3')
  })
})
