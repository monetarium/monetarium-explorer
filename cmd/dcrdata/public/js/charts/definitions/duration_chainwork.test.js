import { describe, it, expect } from 'vitest'
import { durationBtwBlocks, chainwork } from './duration_chainwork'

describe('durationBtwBlocks.toColumns', () => {
  it('height/block axis with offset 1', () => {
    const raw = { axis: 'height', bin: 'block', duration: [10, 20] }
    expect(durationBtwBlocks.toColumns(raw, {})).toEqual([
      [1, 2],
      [10, 20]
    ])
  })
  it('declares a Y floor of 0', () => {
    expect(durationBtwBlocks.yMin).toBe(0)
  })
  it('formats seconds plainly', () => {
    expect(durationBtwBlocks.formatValue(0, { value: 42 }, {})).toBe('42')
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
  it('renders as a filled area (cumulative)', () => {
    expect(chainwork.series[0].kind).toBe('area')
  })
})

describe('durationBtwBlocks series kind', () => {
  it('stays line (per-block interval, not cumulative)', () => {
    expect(durationBtwBlocks.series[0].kind).toBe('line')
  })
})
