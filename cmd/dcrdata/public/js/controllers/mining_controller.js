import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'

export default class extends Controller {
  static get targets() {
    return [
      'difficulty',
      'hashrate',
      'hashrateDelta',
      'bsubsidyPow',
      'powConverted',
      'powBar',
      'rewardIdx'
    ]
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra
    this.difficultyTarget.innerHTML = humanize.threeSigFigs(ex.difficulty)
    this.hashrateTarget.innerHTML = humanize.decimalParts(ex.hash_rate, false, 8, 2)
    this.hashrateDeltaTarget.innerHTML = humanize.fmtPercentage(ex.hash_rate_change_month)
    this.bsubsidyPowTarget.innerHTML = humanize.decimalParts(
      ex.subsidy.pow / 100000000,
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
  }
}
