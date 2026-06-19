import { describe, it, expect, beforeAll } from 'vitest'
import { getDefinition } from '../registry'

beforeAll(async () => {
  await import('./index') // side-effect registration
})

describe('definitions barrel', () => {
  it('registers all static charts', () => {
    for (const name of [
      'ticket-price',
      'ticket-pool-size',
      'ticket-pool-value',
      'stake-participation',
      'block-size',
      'blockchain-size',
      'tx-count',
      'pow-difficulty',
      'coin-supply/0',
      'fees',
      'privacy-participation',
      'duration-btw-blocks',
      'chainwork',
      'hashrate',
      'missed-votes'
    ]) {
      expect(getDefinition(name)).not.toBeNull()
    }
  })
  it('resolves SKA coin-supply and fees via factories', () => {
    expect(getDefinition('coin-supply/3').axes[0].label).toBe('Coin Supply (SKA3)')
    expect(getDefinition('fees/2').axes[0].label).toBe('Total Fee (SKA2)')
  })
})
