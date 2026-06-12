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
      'powSkaRewards',
      'powSubsidy',
      'powFee',
      'activeMiners'
    ]
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra
    this.difficultyTarget.innerHTML = humanize.threeSigFigs(ex.difficulty)
    this.hashrateTarget.innerHTML = humanize.decimalParts(String(ex.hash_rate), false, 8, 2)
    this.hashrateDeltaTarget.innerHTML = humanize.fmtPercentage(ex.hash_rate_change_month)
    this.bsubsidyPowTarget.innerHTML = humanize.decimalParts(
      String((ex.lblock_total_atoms || ex.subsidy.pow) / 100000000),
      false,
      8,
      2
    )
    this.powSubsidyTarget.innerHTML = humanize.decimalParts(
      (ex.cblock_subsidy || ex.subsidy).pow / 100000000,
      false,
      8,
      2
    )
    this.powFeeTarget.innerHTML = humanize.decimalParts(
      (ex.mining_fee_atoms || 0) / 100000000,
      false,
      8,
      2
    )

    this.rewardIdxTarget.textContent = ex.reward_idx
    this.powBarTarget.style.width = `${(ex.reward_idx / ex.params.reward_window_size) * 100}%`

    if (ex.exchange_rate && this.hasPowConvertedTarget) {
      const { value: xcRate, index } = ex.exchange_rate
      const total = (ex.lblock_total_atoms || ex.subsidy.pow) / 100000000
      this.powConvertedTarget.textContent = `${humanize.twoDecimals(total * xcRate)} ${index}`
    }

    this._renderPoWSkaRewards(ex.pow_ska_rewards)

    const n = ex.active_miners
    if (n != null && this.hasActiveMinersTarget) {
      this.activeMinersTarget.textContent = `Mining: ${n} ${n === 1 ? 'miner' : 'miners'}`
    }
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
      const parts = splitSkaAtoms(r.amount || '')

      const decimalPartsEl = clone.querySelector('.decimal-parts')
      if (decimalPartsEl) this._fillDecimalParts(decimalPartsEl, parts)

      const linkEl = clone.querySelector('[data-block-height]')
      if (linkEl && r.block_height) {
        linkEl.href = `/block/${r.block_height}`
      }

      clone.querySelectorAll('.symbol').forEach((el) => {
        el.textContent = r.symbol
      })

      container.appendChild(clone)
    })
  }

  _fillDecimalParts(el, { intPart, bold, rest, trailingZeros }) {
    const intText = bold ? `${intPart}.${bold}` : intPart
    let html = `<span class="int">${intText}</span>`
    if (bold && rest) html += `<span class="decimal">${rest}</span>`
    if (bold && trailingZeros) {
      html += `<span class="decimal trailing-zeroes">${trailingZeros}</span>`
    }
    el.innerHTML = html
  }
}
