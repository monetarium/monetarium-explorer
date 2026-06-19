import { describe, it, expect, beforeEach } from 'vitest'
import {
  register,
  getDefinition,
  coinTypeFromName,
  isCoinSupplyName,
  isSKAFeeName,
  registerCoinFactories,
  _resetRegistry
} from './registry'

beforeEach(() => _resetRegistry())

describe('coinTypeFromName', () => {
  it('maps coin-supply/0 to VAR (0)', () => expect(coinTypeFromName('coin-supply/0')).toBe(0))
  it('maps coin-supply/3 to 3', () => expect(coinTypeFromName('coin-supply/3')).toBe(3))
  it('maps bare fees to VAR (0)', () => expect(coinTypeFromName('fees')).toBe(0))
  it('maps fees/2 to 2', () => expect(coinTypeFromName('fees/2')).toBe(2))
  it('returns 0 for a non-coin chart', () => expect(coinTypeFromName('hashrate')).toBe(0))
})

describe('name predicates', () => {
  it('isCoinSupplyName matches coin-supply and coin-supply/n', () => {
    expect(isCoinSupplyName('coin-supply/0')).toBe(true)
    expect(isCoinSupplyName('coin-supply/5')).toBe(true)
    expect(isCoinSupplyName('fees')).toBe(false)
  })
  it('isSKAFeeName matches only fees/{1..}', () => {
    expect(isSKAFeeName('fees/1')).toBe(true)
    expect(isSKAFeeName('fees')).toBe(false)
    expect(isSKAFeeName('fees/0')).toBe(false)
  })
})

describe('register / getDefinition', () => {
  it('returns a registered static definition by name', () => {
    const def = { name: 'demo', label: 'Demo', controls: {}, axes: [], series: [] }
    register(def)
    expect(getDefinition('demo')).toBe(def)
  })
  it('returns null for an unknown name', () => {
    expect(getDefinition('nope')).toBeNull()
  })
  it('routes coin-supply/n and fees/n through registered factories', () => {
    registerCoinFactories(
      (coinType) => ({
        name: `coin-supply/${coinType}`,
        label: 'S',
        controls: {},
        axes: [],
        series: []
      }),
      (coinType) => ({
        name: coinType === 0 ? 'fees' : `fees/${coinType}`,
        label: 'F',
        controls: {},
        axes: [],
        series: []
      })
    )
    expect(getDefinition('coin-supply/0').name).toBe('coin-supply/0')
    expect(getDefinition('coin-supply/7').name).toBe('coin-supply/7')
    expect(getDefinition('fees').name).toBe('fees')
    expect(getDefinition('fees/4').name).toBe('fees/4')
  })
})
