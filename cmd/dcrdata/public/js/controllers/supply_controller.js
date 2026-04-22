import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'

export default class extends Controller {
  static get targets() {
    return ['varCirculating', 'skaCoinSupply', 'exchangeRate']
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra

    if (ex.var_coin_supply && this.hasVarCirculatingTarget) {
      this.varCirculatingTarget.innerHTML = humanize.decimalParts(
        parseInt(ex.var_coin_supply.circulating) / 1e8,
        true,
        8
      )
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

      const in_circulation_formatted = humanize.formatCoinAtomsFull(e.in_circulation, e.coin_type)
      clone.querySelector('.int').textContent = in_circulation_formatted
      clone.querySelector('.symbol').textContent = `SKA${e.coin_type}`
      clone.querySelector('.issued').textContent = humanize.formatCoinAtomsFull(
        e.total_issued,
        e.coin_type
      )
      clone.querySelector('.burned').textContent = humanize.formatCoinAtomsFull(
        e.total_burned,
        e.coin_type
      )

      container.appendChild(clone)
    })
  }
}
