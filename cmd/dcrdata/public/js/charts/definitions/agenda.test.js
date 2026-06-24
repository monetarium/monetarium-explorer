import { describe, it, expect } from 'vitest'
import { cumulativeVoteChoicesDef, voteChoicesByBlockDef, VOTE_SERIES, formatVote } from './agenda'

const byTime = {
  time: ['2024-06-01T22:00:00Z', '2024-06-02T22:00:00Z'],
  yes: [10, 30],
  abstain: [5, 5],
  no: [5, 15],
  total: [20, 50]
}
const byHeight = {
  height: [4096, 4097],
  yes: [2, 0],
  abstain: [1, 0],
  no: [1, 0],
  total: [4, 0]
}

describe('VOTE_SERIES', () => {
  it('is Yes/Abstain/No with hex colors (fillForStroke needs hex)', () => {
    expect(VOTE_SERIES.map((s) => s.label)).toEqual(['Yes', 'Abstain', 'No'])
    expect(VOTE_SERIES.map((s) => s.field)).toEqual(['yes', 'abstain', 'no'])
    expect(VOTE_SERIES.map((s) => s.color)).toEqual(['#009900', '#ffa500', '#ff0000'])
  })
})

describe('cumulativeVoteChoicesDef (stacked area, time axis)', () => {
  const def = cumulativeVoteChoicesDef()
  it('is a 3-series stacked area chart', () => {
    expect(def.stacked).toBe(true)
    expect(def.series).toHaveLength(3)
    expect(def.series.every((s) => s.kind === 'area')).toBe(true)
    expect(def.series.map((s) => s.color)).toEqual(['#009900', '#ffa500', '#ff0000'])
  })
  it('toColumns maps time->seconds and yes/abstain/no->ys in series order', () => {
    expect(def.toColumns(byTime)).toEqual([
      [1717279200, 1717365600],
      [10, 30],
      [5, 5],
      [5, 15]
    ])
  })
  it('toColumns is empty-safe', () => {
    expect(def.toColumns({})).toEqual([[], [], [], []])
    expect(def.toColumns(null)).toEqual([[], [], [], []])
  })
  it('formatValue shows the raw count + percentage of the 3-series total', () => {
    // idx 1: yes=30 abstain=5 no=15 total=50 -> Yes 60.00%, No 30.00%
    expect(def.formatValue(0, { idx: 1, payload: byTime, value: 999 }, {})).toBe('30 (60.00%)')
    expect(def.formatValue(2, { idx: 1, payload: byTime, value: 999 }, {})).toBe('15 (30.00%)')
  })
  it('formatValue ignores the stacked cumulative datum.value (firewall)', () => {
    // idx 0: yes=10 abstain=5 no=5 total=20 -> Yes 50.00%
    expect(def.formatValue(0, { idx: 0, payload: byTime, value: 12345 }, {})).toBe('10 (50.00%)')
  })
})

describe('voteChoicesByBlockDef (stacked bars, height axis)', () => {
  const def = voteChoicesByBlockDef()
  it('is a 3-series stacked bar chart', () => {
    expect(def.stacked).toBe(true)
    expect(def.series).toHaveLength(3)
    expect(def.series.every((s) => s.kind === 'bars')).toBe(true)
  })
  it('toColumns maps height->xs and yes/abstain/no->ys', () => {
    expect(def.toColumns(byHeight)).toEqual([
      [4096, 4097],
      [2, 0],
      [1, 0],
      [1, 0]
    ])
  })
  it('formatValue renders 0 count and 0% when the block had no votes', () => {
    // idx 1: all zero -> total 0 -> "(0%)", count "0"
    expect(def.formatValue(0, { idx: 1, payload: byHeight, value: 0 }, {})).toBe('0 (0%)')
  })
  it('formatValue shows count + pct for a voted block', () => {
    // idx 0: yes=2 total=4 -> 50.00%
    expect(def.formatValue(0, { idx: 0, payload: byHeight, value: 0 }, {})).toBe('2 (50.00%)')
  })
})

describe('formatVote (shared)', () => {
  it('matches the Dygraphs legendFormatter math: pct=0 (number) when total is 0', () => {
    const p = { yes: [0], abstain: [0], no: [0] }
    expect(formatVote(0, { idx: 0, payload: p })).toBe('0 (0%)')
  })
})
