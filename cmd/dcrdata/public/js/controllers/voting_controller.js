import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import { splitSkaAtoms } from '../helpers/ska_helper'

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
      'varROI',
      'bsubsidyPos',
      'bsubsidy',
      'bfee',
      'convertedStake',
      'skaVoteRewards'
    ]
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra
    this.blocksdiffTarget.innerHTML = humanize.decimalParts(ex.sdiff, false, 8, 2)
    this.nextExpectedSdiffTarget.innerHTML = humanize.decimalParts(ex.next_expected_sdiff, false, 2)
    this.nextExpectedMinTarget.innerHTML = humanize.decimalParts(ex.next_expected_min, false, 2)
    this.nextExpectedMaxTarget.innerHTML = humanize.decimalParts(ex.next_expected_max, false, 2)
    this.windowIndexTarget.textContent = ex.window_idx
    this.posBarTarget.style.width = `${(ex.window_idx / ex.params.window_size) * 100}%`
    this.poolSizeTarget.innerHTML = humanize.decimalParts(ex.pool_info.size, true, 0)
    this.targetPctTarget.textContent = parseFloat(ex.pool_info.percent_target - 100).toFixed(2)
    this.poolValueTarget.innerHTML = humanize.decimalParts(ex.pool_info.value, true, 0)
    this.poolSizePctTarget.textContent = parseFloat(ex.pool_info.percent).toFixed(2)
    this.varROITarget.textContent = ex.vote_var_reward.roi.toFixed(2)
    this.bsubsidyPosTarget.innerHTML = humanize.decimalParts(
      ex.vote_var_reward.per_block,
      false,
      8,
      2
    )
    this.bsubsidyTarget.innerHTML = humanize.decimalParts(ex.vote_var_reward.subsidy, false, 8, 2)
    this.bfeeTarget.innerHTML = humanize.decimalParts(ex.vote_var_reward.fee, false, 8, 2)

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

      // 1. Reward per Block (main value)
      const s = r.per_block || ''
      const isDash = !s
      const blockValueParts = splitSkaAtoms(s)

      const blockDecimalPartsEl = clone.querySelector('[data-field="block-parts"]')
      if (blockDecimalPartsEl) {
        if (isDash) {
          blockDecimalPartsEl.style.display = 'none'
        } else {
          this._fillDecimalParts(blockDecimalPartsEl, blockValueParts)
        }
      }

      const linkEl = clone.querySelector('[data-block-height]')
      if (linkEl && r.block_height) {
        linkEl.href = `/block/${r.block_height}`
      }

      // 2. Annual Return
      const py = r.per_year || ''
      const pyParts = splitSkaAtoms(py)
      const pyDecimalPartsEl = clone.querySelector('[data-field="peryear-parts"]')
      if (pyDecimalPartsEl) {
        this._fillDecimalParts(pyDecimalPartsEl, pyParts)
      }

      // 3. Units and other fields
      clone.querySelectorAll('[data-field]').forEach((el) => {
        const field = el.dataset.field
        if (field === 'unit') {
          el.textContent = isDash ? `— ${r.symbol}/Vote` : `${r.symbol}/Vote`
        } else if (field === 'peryear-unit') {
          el.textContent = ` ${r.symbol}/VAR per year`
        }
        el.removeAttribute('data-field')
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
