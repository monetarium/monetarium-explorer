import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const { default: VotingController } = await import('./voting_controller.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// buildContainer mirrors the live-update DOM of home_voting.tmpl: a
// skaVoteRewards container holding the server-rendered "No SKA rewards
// available" placeholder, plus the two <template> elements the controller
// clones from.
function buildContainer() {
  document.body.innerHTML = `
<div data-voting-target="skaVoteRewards" class="d-flex flex-column">
  <div class="fs12 lh1rem text-black-50">No SKA rewards available</div>
</div>
<template id="ska-reward-block-template">
  <div>
    <a class="text-decoration-none" data-block-height>
      <div class="mono">
        <div class="decimal-parts d-inline-block" data-field="block-parts"><span class="int"></span></div>
        <span class="unit" data-field="unit"></span>
      </div>
    </a>
    <div class="fs12">
      <div class="decimal-parts d-inline-block" data-field="peryear-parts"><span class="int"></span></div>
      <span data-field="peryear-unit"></span>
    </div>
  </div>
</template>
<template id="ska-vote-empty-template">
  <div class="fs12 lh1rem text-black-50">No SKA rewards available</div>
</template>
`
  const container = document.querySelector('[data-voting-target="skaVoteRewards"]')
  const ctrl = new VotingController(document.body)
  ctrl.skaVoteRewardsTarget = container
  ctrl.hasSkaVoteRewardsTarget = true
  return { container, ctrl }
}

// ---------------------------------------------------------------------------
// Issue #436: "No SKA rewards available" disappears on websocket newblock
// ---------------------------------------------------------------------------

describe('voting_controller — SKA rewards empty-state (issue #436)', () => {
  let container, ctrl
  beforeEach(() => {
    ;({ container, ctrl } = buildContainer())
  })

  it('keeps the placeholder when rewards is undefined (mainnet: ska_vote_rewards omitted)', () => {
    expect(() => ctrl._renderSkaRewards(undefined)).not.toThrow()
    expect(container.textContent).toContain('No SKA rewards available')
  })

  it('keeps the placeholder when rewards is null', () => {
    expect(() => ctrl._renderSkaRewards(null)).not.toThrow()
    expect(container.textContent).toContain('No SKA rewards available')
  })

  it('keeps the placeholder when rewards is an empty array', () => {
    ctrl._renderSkaRewards([])
    expect(container.textContent).toContain('No SKA rewards available')
  })

  it('restores the placeholder when a later block clears previously rendered rewards', () => {
    // First a block carrying a reward removes the placeholder and renders it.
    ctrl._renderSkaRewards([
      {
        coin_type: 1,
        symbol: 'SKA1',
        per_block: '1000000000000000000',
        per_year: '365000000000000000000'
      }
    ])
    expect(container.textContent).not.toContain('No SKA rewards available')

    // A subsequent block with no rewards must bring the placeholder back.
    ctrl._renderSkaRewards([])
    expect(container.textContent).toContain('No SKA rewards available')
  })

  it('renders reward rows and drops the placeholder when rewards are present', () => {
    ctrl._renderSkaRewards([
      {
        coin_type: 1,
        symbol: 'SKA1',
        per_block: '1000000000000000000',
        per_year: '365000000000000000000',
        block_height: 4096
      }
    ])
    expect(container.textContent).not.toContain('No SKA rewards available')
    expect(container.textContent).toContain('SKA1/Vote')
    const link = container.querySelector('a[href="/block/4096"]')
    expect(link).not.toBeNull()
  })
})
