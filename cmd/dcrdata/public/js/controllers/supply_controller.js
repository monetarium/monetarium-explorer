import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import { renderCoinType, splitSkaAtomsNoTrailing } from '../helpers/ska_helper'

export default class extends Controller {
  static get targets() {
    return ['varCirculating', 'varSupplyShare', 'skaCoinSupply', 'exchangeRate']
  }

  static VAR_MAX_SUPPLY = 54_000_000

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra

    if (ex.var_coin_supply && this.hasVarCirculatingTarget) {
      const raw = humanize.formatAtomsAsCoinString(ex.var_coin_supply.circulating, 0, 2)
      const clean = raw.replace(/,/g, '')

      this.varCirculatingTarget.innerHTML = humanize.decimalParts(clean, true, 8, 2, true)

      if (this.hasVarSupplyShareTarget) {
        const coins = parseFloat(clean)
        const pct = (coins / this.constructor.VAR_MAX_SUPPLY) * 100
        this.varSupplyShareTarget.textContent = `${pct.toFixed(1)}% of ~54M`
      }
    }

    if (ex.ska_coin_supply && this.hasSkaCoinSupplyTarget) {
      this._renderSkaCoinSupply(ex.ska_coin_supply)
    }

    if (ex.exchange_rate && this.hasExchangeRateTarget) {
      this.exchangeRateTarget.textContent = humanize.twoDecimals(ex.exchange_rate.value)
    }
  }

  _renderSkaCoinSupply(entries) {
    const tmpl = document.getElementById('ska-supply-block-template')
    if (!tmpl) return

    const container = this.skaCoinSupplyTarget
    container.innerHTML = ''
    if (!Array.isArray(entries) || entries.length === 0) return

    entries.forEach((e) => {
      const clone = document.importNode(tmpl.content, true)

      clone.querySelector('.symbol').textContent = renderCoinType(e.coin_type)

      const inCirculationEl = clone.querySelector('.in-circulation')
      if (inCirculationEl) {
        this._fillDecimalParts(
          inCirculationEl,
          splitSkaAtomsNoTrailing(e.in_circulation || '', true)
        )
      }

      const issuedEl = clone.querySelector('.issued')
      if (issuedEl) {
        this._fillDecimalParts(issuedEl, splitSkaAtomsNoTrailing(e.total_issued || '', true))
      }

      const burnedEl = clone.querySelector('.burned')
      if (burnedEl) {
        this._fillDecimalParts(burnedEl, splitSkaAtomsNoTrailing(e.total_burned || '', true))
      }

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
