import { describe, it, expect } from 'vitest'
import { durationBtwBlocks, chainwork } from './duration_chainwork'

describe('durationBtwBlocks.toColumns', () => {
  it('height/block axis → 0-based index', () => {
    const raw = { axis: 'height', bin: 'block', duration: [10, 20] }
    expect(durationBtwBlocks.toColumns(raw, {})).toEqual([
      [0, 1],
      [10, 20]
    ])
  })
  it('declares a Y floor of 0', () => {
    expect(durationBtwBlocks.yMin).toBe(0)
  })
  it('formats seconds plainly', () => {
    expect(durationBtwBlocks.formatValue(0, { value: 42 }, {})).toBe('42')
  })
  it('null value renders n/a instead of throwing', () => {
    expect(durationBtwBlocks.formatValue(0, { value: null }, {})).toBe('n/a')
  })
})

describe('chainwork', () => {
  const raw = { axis: 'time', t: [1000, 2000], work: [1500, 3_000_000] }
  it('plots work', () => {
    expect(chainwork.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [1500, 3_000_000]
    ])
  })
  it('axisLabel scales the unit to the max magnitude', () => {
    expect(chainwork.axisLabel(raw)).toBe('Cumulative Chainwork (MH)')
  })
  it('legend uses big units', () => {
    expect(chainwork.formatValue(0, { value: 1500 }, {})).toBe('1.500 kH')
  })
  it('renders a real 0 as 0.000 H but null as n/a', () => {
    expect(chainwork.formatValue(0, { value: 0 }, {})).toBe('0.000 H')
    expect(chainwork.formatValue(0, { value: null }, {})).toBe('n/a')
  })
  it('renders as a filled area (cumulative)', () => {
    expect(chainwork.series[0].kind).toBe('area')
  })
})

describe('durationBtwBlocks series kind', () => {
  it('stays line (per-block interval, not cumulative)', () => {
    expect(durationBtwBlocks.series[0].kind).toBe('line')
  })
})
