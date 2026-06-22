import { describe, it, expect } from 'vitest'
import { ticketPrice } from './ticket_price'

describe('ticketPrice.toColumns', () => {
  it('time axis: [t, price*1e-8, count]', () => {
    const raw = { t: [1000, 2000], price: [200000000, 300000000], count: [5, 7] }
    expect(ticketPrice.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [2, 3],
      [5, 7]
    ])
  })
  it('window/height axis: X = i*window', () => {
    const raw = { price: [100000000, 200000000], count: [1, 2], window: 144 }
    expect(ticketPrice.toColumns(raw, {})).toEqual([
      [0, 144],
      [1, 2],
      [1, 2]
    ])
  })
  it('height axis: explicit h takes precedence over window index', () => {
    // The live-tip point is appended at a window start that need not equal
    // i*window (last height 290, not 144), so h must win over the derivation.
    const raw = { price: [100000000, 200000000], count: [1, 2], h: [0, 290], window: 144 }
    expect(ticketPrice.toColumns(raw, {})).toEqual([
      [0, 290],
      [1, 2],
      [1, 2]
    ])
  })
})

describe('ticketPrice.formatValue', () => {
  const raw = { t: [1000], price: [123456789], count: [42] }
  const datum = { idx: 0, payload: raw, value: 1.23456789 }
  it('series 0 (Price) renders 8-decimal VAR', () => {
    expect(ticketPrice.formatValue(0, datum, {})).toBe('1.23456789 VAR')
  })
  it('series 1 (Tickets Bought) renders a rounded integer', () => {
    expect(ticketPrice.formatValue(1, { ...datum, value: 42 }, {})).toBe('42')
  })
  it('null value renders n/a instead of throwing (both series)', () => {
    expect(ticketPrice.formatValue(0, { ...datum, value: null }, {})).toBe('n/a')
    expect(ticketPrice.formatValue(1, { ...datum, value: null }, {})).toBe('n/a')
  })
})

describe('ticketPrice.controls', () => {
  it('is window-unit, scale-disabled, mode-enabled, dual-visibility', () => {
    expect(ticketPrice.controls.windowUnits).toBe(true)
    expect(ticketPrice.controls.scale).toBe(false)
    expect(ticketPrice.controls.mode).toBe(true)
    expect(ticketPrice.controls.visibility).toEqual(['Price', 'Tickets Bought'])
  })
})
