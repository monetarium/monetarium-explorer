import { describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const { default: MiningController } = await import('./mining_controller.js')

// buildMiningCtrl wires every target handleBlock() writes to (Stimulus is
// mocked, so targets are assigned manually) and disables the optional branches.
function buildMiningCtrl() {
  const ctrl = new MiningController(document.body)
  const names = [
    'difficulty',
    'hashrate',
    'hashrateDelta',
    'bsubsidyPow',
    'powSubsidy',
    'powFee',
    'rewardIdx',
    'powBar',
    'rewardRemaining'
  ]
  names.forEach((n) => {
    ctrl[`${n}Target`] = document.createElement('span')
  })
  ctrl.hasPowConvertedTarget = false
  ctrl.hasPowSkaRewardsTarget = false
  ctrl.hasActiveMinersTarget = false
  return ctrl
}

function miningBlock(overrides = {}) {
  return {
    detail: {
      extra: {
        difficulty: 1234,
        hash_rate: 5000,
        hash_rate_change_month: 2.5,
        lblock_total_atoms: 1600000000,
        subsidy: { pow: 1600000000 },
        cblock_subsidy: { pow: 1600000000 },
        mining_fee_atoms: 100000,
        reward_idx: 1,
        params: { reward_window_size: 144 },
        reward_remaining: 'imminent',
        ...overrides
      }
    }
  }
}

describe('mining_controller — reward-window live estimate (issue #502 sibling)', () => {
  it('writes ex.reward_remaining verbatim to the estimate target', () => {
    const ctrl = buildMiningCtrl()
    ctrl.handleBlock(miningBlock({ reward_remaining: '5h 1m remaining' }))
    expect(ctrl.rewardRemainingTarget.textContent).toBe('5h 1m remaining')
  })

  it('reverts imminent -> time-remaining on the next block without refresh', () => {
    const ctrl = buildMiningCtrl()
    ctrl.handleBlock(miningBlock({ reward_remaining: 'imminent', reward_idx: 144 }))
    expect(ctrl.rewardRemainingTarget.textContent).toBe('imminent')

    ctrl.handleBlock(miningBlock({ reward_remaining: '5h 1m remaining', reward_idx: 1 }))
    expect(ctrl.rewardRemainingTarget.textContent).toBe('5h 1m remaining')
  })
})
