import { describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const { default: SupplyController } = await import('./supply_controller.js')

function makeCtrl() {
  return new SupplyController(document.createElement('div'))
}

describe('SupplyController._formatAtomInt', () => {
  const ctrl = makeCtrl()

  it('returns "0" for empty string', () => expect(ctrl._formatAtomInt('', 8)).toBe('0'))
  it('returns "0" for "0"', () => expect(ctrl._formatAtomInt('0', 8)).toBe('0'))
  it('returns "0" for invalid input', () => expect(ctrl._formatAtomInt('abc', 8)).toBe('0'))
  it('returns "0" for sub-unit VAR atom', () => expect(ctrl._formatAtomInt('1', 8)).toBe('0'))
  it('formats 1 VAR correctly', () => expect(ctrl._formatAtomInt('100000000', 8)).toBe('1'))
  it('formats 21M VAR with commas', () =>
    expect(ctrl._formatAtomInt('2100000000000000', 8)).toBe('21,000,000'))
  it('truncates VAR fractional atoms', () =>
    expect(ctrl._formatAtomInt('4200000012345678', 8)).toBe('42,000,000'))

  it('returns "0" for sub-unit SKA atom', () => expect(ctrl._formatAtomInt('1', 18)).toBe('0'))
  it('formats 1 SKA correctly', () =>
    expect(ctrl._formatAtomInt('1000000000000000000', 18)).toBe('1'))
  it('formats SKA circulating (real-world, truncates .84)', () =>
    expect(ctrl._formatAtomInt('899999999991999840000000000000000', 18)).toBe(
      '899,999,999,991,999'
    ))
  it('formats SKA issued', () =>
    expect(ctrl._formatAtomInt('900000000000000000000000000000000', 18)).toBe(
      '900,000,000,000,000'
    ))
  it('formats SKA burned (truncates .16)', () =>
    expect(ctrl._formatAtomInt('8000160000000000000000', 18)).toBe('8,000'))
})

describe('SupplyController._formatVARInt / _formatSKAInt wrappers', () => {
  const ctrl = makeCtrl()

  it('_formatVARInt delegates to _formatAtomInt with 8 decimals', () =>
    expect(ctrl._formatVARInt('100000000')).toBe('1'))
  it('_formatSKAInt delegates to _formatAtomInt with 18 decimals', () =>
    expect(ctrl._formatSKAInt('1000000000000000000')).toBe('1'))
})
