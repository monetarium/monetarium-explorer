import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import { splitSkaValue } from '../helpers/ska_helper'

export default class extends Controller {
  static get targets() {
    return [
      'blocksdiff',
      'nextExpectedSdiff',
      'nextExpectedMin',
      'nextExpectedMax',
      'windowIndex',
      'posBar',
      'poolSize',
      'poolValue',
      'poolSizePct',
      'targetPct',
      'ticketReward',
      'bsubsidyPos',
      'convertedStake',
      'skaVoteRewards'
    ]
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra
    this.blocksdiffTarget.innerHTML = humanize.decimalParts(String(ex.sdiff), false, 8, 2)
    this.nextExpectedSdiffTarget.innerHTML = humanize.decimalParts(
      String(ex.next_expected_sdiff),
      false,
      2,
      2
    )
    this.nextExpectedMinTarget.innerHTML = humanize.decimalParts(
      String(ex.next_expected_min),
      false,
      2,
      2
    )
    this.nextExpectedMaxTarget.innerHTML = humanize.decimalParts(
      String(ex.next_expected_max),
      false,
      2,
      2
    )
    this.windowIndexTarget.textContent = ex.window_idx
    this.posBarTarget.style.width = `${(ex.window_idx / ex.params.window_size) * 100}%`
    this.poolSizeTarget.innerHTML = humanize.decimalParts(String(ex.pool_info.size), true, 0)
    this.targetPctTarget.textContent = parseFloat(ex.pool_info.percent_target - 100).toFixed(2)
    this.poolValueTarget.innerHTML = humanize.decimalParts(String(ex.pool_info.value), true, 0)
    this.poolSizePctTarget.textContent = parseFloat(ex.pool_info.percent).toFixed(2)
    this.ticketRewardTarget.innerHTML = `${ex.reward.toFixed(2)}%`
    this.bsubsidyPosTarget.innerHTML = humanize.decimalParts(
      String(ex.subsidy.pos / 500000000),
      false,
      8,
      2
    )

    if (ex.exchange_rate && this.hasConvertedStakeTarget) {
      const { value: xcRate, index } = ex.exchange_rate
      this.convertedStakeTarget.textContent = `${humanize.twoDecimals(ex.sdiff * xcRate)} ${index}`
    }

    this._renderSkaRewards(ex.ska_vote_rewards)
  }

  _renderSkaRewards(rewards) {
    if (!this.hasSkaVoteRewardsTarget) return
    const tmpl = document.getElementById('ska-reward-block-template')
    if (!tmpl) return

    const container = this.skaVoteRewardsTarget
    container.innerHTML = ''

    rewards.forEach((r) => {
      const clone = document.importNode(tmpl.content, true)

      const s = r.per_block || ''
      const isDash = !s

      const decimalPartsEl = clone.querySelector('.decimal-parts')
      if (decimalPartsEl && isDash) decimalPartsEl.style.display = 'none'

      const { intPart, bold, rest, trailingZeros } = splitSkaValue(s)

      const intEl = clone.querySelector('.int')
      const decEl = clone.querySelector('.decimal:not(.trailing-zeroes)')
      const trailEl = clone.querySelector('.trailing-zeroes')

      if (intEl) intEl.textContent = bold ? `${intPart}.${bold}` : intPart
      if (decEl) decEl.textContent = rest
      if (trailEl) trailEl.textContent = trailingZeros

      clone.querySelectorAll('[data-field]').forEach((el) => {
        const field = el.dataset.field
        if (field === 'unit') {
          el.textContent = isDash ? `— ${r.symbol}/Vote` : `${r.symbol}/Vote`
        } else if (field === 'per30d') {
          el.textContent = `${r.per_30_days} ${r.symbol}/VAR per 30 days`
        } else if (field === 'peryear') {
          el.textContent = `${r.per_year} ${r.symbol}/VAR per year`
        }
        el.removeAttribute('data-field')
      })

      container.appendChild(clone)
    })
  }
}
