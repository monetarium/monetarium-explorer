import { describe, it, expect } from 'vitest'
import { secondsFromTimes, balanceDef, typesDef, amountflowDef } from './address'

describe('secondsFromTimes', () => {
  it('converts RFC3339 strings to integer seconds', () => {
    expect(secondsFromTimes(['1970-01-01T00:00:00Z', '2024-06-01T22:00:00Z'])).toEqual([
      0, 1717279200
    ])
  })
})

describe('balanceDef VAR (coin 0)', () => {
  const def = balanceDef(0)
  const raw = { time: ['2024-06-01T22:00:00Z'], balance: [12.5] }
  it('is a single stepped series', () => {
    expect(def.series).toHaveLength(1)
    expect(def.series[0].kind).toBe('stepped')
  })
  it('toColumns maps time->seconds and balance->ys (no pad when binSize=0)', () => {
    expect(def.toColumns(raw, { binSize: 0 })).toEqual([[1717279200], [12.5]])
  })
  it('toColumns prepends leading 0-balance and appends sustain pad when binSize is provided', () => {
    // Single point: duration=0 < binSize=86400, pad = Math.max(43200, (86400-0)/2) = 43200
    // firstX=1717279200, leading point at 1717279200-43200=1717236000 (value 0),
    // trailing sustain at 1717279200+43200=1717322400 (value 12.5).
    expect(def.toColumns(raw, { binSize: 86400 })).toEqual([
      [1717236000, 1717279200, 1717322400],
      [0, 12.5, 12.5]
    ])
  })
  it('formatValue renders VAR with the value', () => {
    expect(def.formatValue(0, { idx: 0, payload: raw, value: 12.5 }, {})).toBe('12.5 VAR')
  })
  it('formatValue renders VAR leading-pad point (value 0) as literal 0', () => {
    expect(def.formatValue(0, { idx: 0, payload: raw, value: 0 }, {})).toBe('0 VAR')
  })
})

describe('balanceDef SKA (coin 2) — precision firewall', () => {
  const def = balanceDef(2)
  const raw = { time: ['2024-06-01T22:00:00Z'], balance_atoms: ['12345678901234567890123'] }
  it('toColumns plots a lossy number for geometry only', () => {
    const cols = def.toColumns(raw)
    expect(cols[0]).toEqual([1717279200])
    expect(typeof cols[1][0]).toBe('number')
  })
  it('formatValue returns the EXACT 18-decimal string (no Number())', () => {
    // toColumns brackets real points with a leading pad, so uPlot idx 1 → payload idx 0.
    const datum = { idx: 1, payload: raw, value: 12345.678 }
    expect(def.formatValue(0, datum, {})).toBe('12,345.678901234567890123 SKA2')
  })
  it('formatValue renders the leading-pad point (idx 0, value 0) as literal 0', () => {
    const datum = { idx: 0, payload: raw, value: 0 }
    expect(def.formatValue(0, datum, {})).toBe('0 SKA2')
  })
  it('formatValue clamps the synthetic back-sustain point (idx beyond payload)', () => {
    // idx:2 is beyond the 1-element payload array — clamps to atoms[0]
    const datum = {
      idx: 2,
      payload: { balance_atoms: ['12345678901234567890123'] },
      value: 12345.678
    }
    expect(def.formatValue(0, datum, {})).toBe('12,345.678901234567890123 SKA2')
  })
})

describe('typesDef (Tx Type stacked bars)', () => {
  const def = typesDef()
  const raw = {
    time: ['2024-06-01T22:00:00Z', '2024-06-02T22:00:00Z'],
    sentRtx: [1, 2],
    receivedRtx: [3, 4],
    tickets: [0, 1],
    votes: [5, 0],
    revokeTx: [0, 0]
  }
  it('is stacked with 5 left-aligned full-bin bar series (histogram)', () => {
    expect(def.stacked).toBe(true)
    expect(def.series).toHaveLength(5)
    expect(def.series.every((s) => s.kind === 'bars')).toBe(true)
    // Histogram geometry: left edge at the bucket start, full-bin width (uncapped).
    expect(def.series.every((s) => s.barAlign === 1)).toBe(true)
    expect(def.series.every((s) => Array.isArray(s.barSize))).toBe(true)
  })
  it('toColumns emits xs + 5 raw count columns (no trailing pad without binSize)', () => {
    const cols = def.toColumns(raw)
    expect(cols[0]).toEqual([1717279200, 1717365600])
    expect(cols.slice(1)).toHaveLength(5)
    // columns align to def.series order
    const labels = def.series.map((s) => s.label)
    const sentIdx = labels.indexOf('Sending (regular)') + 1
    expect(cols[sentIdx]).toEqual([1, 2])
  })
  it('toColumns appends a trailing null bucket when binSize is provided (issues 2/3)', () => {
    // Left-aligned bars are stamped at the bucket start, so the last (current) period's bar
    // extends one bin to the right. A trailing x one bin past the last (null y for every
    // series → no bar) extends the domain so that bar is fully visible and the axis reaches
    // the end of the current period. binSize is in seconds.
    const cols = def.toColumns(raw, { binSize: 2628000 }) // ~1 month
    expect(cols[0]).toEqual([1717279200, 1717365600, 1717365600 + 2628000])
    cols.slice(1).forEach((col) => {
      expect(col).toHaveLength(3)
      expect(col[2]).toBeNull() // trailing bucket draws no bar
    })
  })
  it('formatValue reads the raw count from the payload by index', () => {
    const labels = def.series.map((s) => s.label)
    const votesIdx = labels.indexOf('Votes')
    expect(def.formatValue(votesIdx, { idx: 0, payload: raw, value: 999 }, {})).toBe('5')
  })
})

describe('amountflowDef VAR (coin 0)', () => {
  const def = amountflowDef(0)
  const raw = {
    time: ['2024-06-01T22:00:00Z'],
    received: [10],
    sent: [3],
    net: [7] // net > 0 -> Net Received = 7, Net Spent = 0
  }
  const labels = def.series.map((s) => s.label)
  it('is stacked with 4 left-aligned full-bin bar series in fixed label order', () => {
    expect(def.stacked).toBe(true)
    expect(labels).toEqual(['Received', 'Spent', 'Net Received', 'Net Spent'])
    expect(def.series.every((s) => s.barAlign === 1)).toBe(true)
    expect(def.series.every((s) => Array.isArray(s.barSize))).toBe(true)
  })
  it('toColumns splits net by sign (no trailing pad without binSize)', () => {
    const cols = def.toColumns(raw)
    expect(cols[0]).toEqual([1717279200])
    expect(cols[1]).toEqual([10]) // Received
    expect(cols[2]).toEqual([3]) // Spent
    expect(cols[3]).toEqual([7]) // Net Received
    expect(cols[4]).toEqual([0]) // Net Spent
  })
  it('toColumns appends a trailing null bucket when binSize is provided (issues 2/3)', () => {
    const cols = def.toColumns(raw, { binSize: 2628000 })
    expect(cols[0]).toEqual([1717279200, 1717279200 + 2628000])
    expect(cols[1]).toEqual([10, null]) // Received + trailing null
    expect(cols[4]).toEqual([0, null]) // Net Spent + trailing null
  })
  it('formatValue renders VAR per series', () => {
    expect(def.formatValue(0, { idx: 0, payload: raw, value: 10 }, {})).toBe('10 VAR')
    expect(def.formatValue(3, { idx: 0, payload: raw, value: 0 }, {})).toBe('0 VAR')
  })
  it('VAR formatValue reads the raw payload, ignoring the cumulative datum.value', () => {
    // datum.value is the stacked cumulative total (e.g. 13 = received+spent) — must be ignored
    expect(def.formatValue(1, { idx: 0, payload: raw, value: 13 }, {})).toBe('3 VAR') // Spent raw=3
    expect(def.formatValue(2, { idx: 0, payload: raw, value: 999 }, {})).toBe('7 VAR') // Net Received raw=7
    expect(def.formatValue(3, { idx: 0, payload: raw, value: 999 }, {})).toBe('0 VAR') // Net Spent=0 (net>0)
  })
})

describe('amountflowDef VAR net negative', () => {
  const def = amountflowDef(0)
  const raw = { time: ['2024-06-01T22:00:00Z'], received: [1], sent: [5], net: [-4] }
  it('routes a negative net to Net Spent', () => {
    const cols = def.toColumns(raw)
    expect(cols[3]).toEqual([0]) // Net Received
    expect(cols[4]).toEqual([4]) // Net Spent (magnitude)
  })
})

describe('amountflowDef SKA (coin 1) — precision firewall', () => {
  const def = amountflowDef(1)
  const raw = {
    time: ['2024-06-01T22:00:00Z'],
    received_atoms: ['1000000000000000001'],
    sent_atoms: ['0'],
    net_atoms: ['1000000000000000001']
  }
  it('toColumns plots lossy numbers for geometry', () => {
    const cols = def.toColumns(raw)
    expect(typeof cols[1][0]).toBe('number')
  })
  it('formatValue returns exact atom strings (no Number())', () => {
    // Received series
    expect(def.formatValue(0, { idx: 0, payload: raw, value: 1.0 }, {})).toBe(
      '1.000000000000000001 SKA1'
    )
    // Net Received reads net_atoms (positive)
    expect(def.formatValue(2, { idx: 0, payload: raw, value: 1.0 }, {})).toBe(
      '1.000000000000000001 SKA1'
    )
  })
  it('formatValue sign-splits a negative net_atoms for Net Spent', () => {
    const negRaw = {
      time: ['2024-06-01T22:00:00Z'],
      received_atoms: ['0'],
      sent_atoms: ['5000000000000000000'],
      net_atoms: ['-5000000000000000000']
    }
    // Net Spent series shows the magnitude
    expect(def.formatValue(3, { idx: 0, payload: negRaw, value: 5 }, {})).toBe('5 SKA1')
  })
})
