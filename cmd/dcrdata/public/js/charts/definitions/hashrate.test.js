import { describe, it, expect } from 'vitest'
import { hashrate } from './hashrate'

describe('hashrate.toColumns', () => {
  it('single series when no active_miners: [x, rate] (block bin → 1-based, offset ignored)', () => {
    const raw = { axis: 'height', bin: 'block', rate: [100, 200], offset: 0 }
    expect(hashrate.toColumns(raw, {})).toEqual([
      [1, 2],
      [100, 200]
    ])
  })
  it('dual series with active_miners: [x, rate, miners]', () => {
    const raw = {
      axis: 'height',
      bin: 'block',
      rate: [100, 200],
      active_miners: [3, 4],
      offset: 0
    }
    expect(hashrate.toColumns(raw, {})).toEqual([
      [1, 2],
      [100, 200],
      [3, 4]
    ])
  })
  it('day bin applies offset (HashrateAvgLength) to heights', () => {
    const raw = { axis: 'height', bin: 'day', h: [10, 20], rate: [100, 200], offset: 120 }
    expect(hashrate.toColumns(raw, {})).toEqual([
      [130, 140],
      [100, 200]
    ])
  })
})

describe('hashrate.axisLabel', () => {
  it('scales unit by max rate', () => {
    expect(hashrate.axisLabel({ rate: [1500, 2000] })).toBe('Network Hashrate (kH/s)')
    expect(hashrate.axisLabel({ rate: [10, 20] })).toBe('Network Hashrate (H/s)')
  })
})

describe('hashrate.formatValue', () => {
  it('series 0 uses big hashrate units', () => {
    expect(hashrate.formatValue(0, { value: 1500 }, {})).toBe('1.500 kH/s')
  })
  it('series 1 (Active Miners) rounds', () => {
    expect(hashrate.formatValue(1, { value: 3.4 }, {})).toBe('3')
  })
})

describe('hashrate.controls', () => {
  it('is mode-enabled, interval-enabled, dual-visibility', () => {
    expect(hashrate.controls.mode).toBe(true)
    expect(hashrate.controls.interval).toBe(true)
    expect(hashrate.controls.visibility).toEqual(['Hashrate', 'Active Miners'])
  })
})
