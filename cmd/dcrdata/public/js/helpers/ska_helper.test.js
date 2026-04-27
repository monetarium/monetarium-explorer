import { describe, expect, it } from 'vitest'
import { renderCoinType } from './ska_helper'

describe('renderCoinType', () => {
  // numeric inputs — valid range
  it('returns "VAR" for 0', () => expect(renderCoinType(0)).toBe('VAR'))
  it('returns "SKA1" for 1', () => expect(renderCoinType(1)).toBe('SKA1'))
  it('returns "SKA2" for 2', () => expect(renderCoinType(2)).toBe('SKA2'))
  it('returns "SKA255" for 255', () => expect(renderCoinType(255)).toBe('SKA255'))

  // string inputs — valid range
  it('returns "VAR" for "0"', () => expect(renderCoinType('0')).toBe('VAR'))
  it('returns "SKA1" for "1"', () => expect(renderCoinType('1')).toBe('SKA1'))
  it('returns "SKA255" for "255"', () => expect(renderCoinType('255')).toBe('SKA255'))

  // fallback — null / undefined
  it('returns "-" for null', () => expect(renderCoinType(null)).toBe('-'))
  it('returns "-" for undefined', () => expect(renderCoinType(undefined)).toBe('-'))

  // fallback — out of range
  it('returns "-" for -1', () => expect(renderCoinType(-1)).toBe('-'))
  it('returns "-" for 256', () => expect(renderCoinType(256)).toBe('-'))

  // fallback — non-numeric string
  it('returns "-" for "VAR"', () => expect(renderCoinType('VAR')).toBe('-'))
  it('returns "-" for ""', () => expect(renderCoinType('')).toBe('-'))

  // fallback — float
  it('returns "-" for 1.5', () => expect(renderCoinType(1.5)).toBe('-'))
  it('returns "-" for "1.5"', () => expect(renderCoinType('1.5')).toBe('-'))
})
