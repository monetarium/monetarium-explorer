import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import { splitSkaAtoms } from '../helpers/ska_helper'

export default class extends Controller {
  static get targets() {
    return [
      'difficulty',
      'hashrate',
      'hashrateDelta',
      'bsubsidyPow',
      'powConverted',
      'powBar',
      'rewardIdx',
      'powSkaRewards'
    ]
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra
    this.difficultyTarget.innerHTML = humanize.threeSigFigs(ex.difficulty)
    this.hashrateTarget.innerHTML = humanize.decimalParts(String(ex.hash_rate), false, 8, 2)
    this.hashrateDeltaTarget.innerHTML = humanize.fmtPercentage(ex.hash_rate_change_month)
    this.bsubsidyPowTarget.innerHTML = humanize.decimalParts(
      String(ex.subsidy.pow / 100000000),
      false,
      8,
      2
    )
    this.rewardIdxTarget.textContent = ex.reward_idx
    this.powBarTarget.style.width = `${(ex.reward_idx / ex.params.reward_window_size) * 100}%`

    if (ex.exchange_rate && this.hasPowConvertedTarget) {
      const { value: xcRate, index } = ex.exchange_rate
      this.powConvertedTarget.textContent = `${humanize.twoDecimals((ex.subsidy.pow / 1e8) * xcRate)} ${index}`
    }

    this._renderPoWSkaRewards(ex.pow_ska_rewards)
  }

  _renderPoWSkaRewards(rewards) {
    if (!this.hasPowSkaRewardsTarget) return
    const tmpl = document.getElementById('pow-ska-reward-template')
    if (!tmpl) return

    const container = this.powSkaRewardsTarget
    container.innerHTML = ''

    if (!Array.isArray(rewards) || rewards.length === 0) {
      const emptyTmpl = document.getElementById('pow-ska-empty-template')
      if (emptyTmpl) container.appendChild(document.importNode(emptyTmpl.content, true))
      return
    }

    rewards.forEach((r) => {
      const clone = document.importNode(tmpl.content, true)
      const { intPart, bold, rest, trailingZeros } = splitSkaAtoms(r.amount || '')

      const intEl = clone.querySelector('.int')
      const decEl = clone.querySelector('.decimal:not(.trailing-zeroes)')
      const trailEl = clone.querySelector('.trailing-zeroes')

      if (intEl) intEl.textContent = bold ? `${intPart}.${bold}` : intPart
      if (decEl) decEl.textContent = bold ? rest : ''
      if (trailEl) trailEl.textContent = bold ? trailingZeros : ''

      clone.querySelectorAll('.symbol').forEach((el) => {
        el.textContent = r.symbol
      })

      container.appendChild(clone)
    })
  }
}
