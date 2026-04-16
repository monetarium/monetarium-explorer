import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets() {
    return ['varCirculating', 'exchangeRate', 'skaCoinSupply']
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra

    if (ex.var_coin_supply && this.hasVarCirculatingTarget) {
      this.varCirculatingTarget.textContent = this._formatVARInt(ex.var_coin_supply.circulating)
    }

    if (ex.ska_coin_supply && this.hasSkaCoinSupplyTarget) {
      this._renderSKASupply(ex.ska_coin_supply)
    }

    if (ex.exchange_rate && this.hasExchangeRateTarget) {
      this.exchangeRateTarget.textContent = parseFloat(ex.exchange_rate.value).toFixed(2)
    }
  }

  _renderSKASupply(entries) {
    const tmpl = document.getElementById('ska-supply-block-template')
    if (!tmpl) return

    const container = this.skaCoinSupplyTarget
    container.innerHTML = ''

    if (!Array.isArray(entries) || entries.length === 0) return

    entries.forEach((entry) => {
      const clone = document.importNode(tmpl.content, true)
      clone.querySelector('.int').textContent = this._formatSKAInt(entry.in_circulation)
      clone.querySelector('.symbol').textContent = `SKA-${entry.coin_type}`
      clone.querySelector('.issued').textContent = this._formatSKAInt(entry.total_issued)
      clone.querySelector('.burned').textContent = this._formatSKAInt(entry.total_burned)
      container.appendChild(clone)
    })
  }

  // Converts an atom string to an exact integer string with comma separators.
  // decimals: number of decimal places (8 for VAR, 18 for SKA).
  // Uses BigInt to avoid float64 precision loss.
  _formatAtomInt(atomStr, decimals) {
    if (!atomStr || atomStr === '0') return '0'
    try {
      const whole = BigInt(atomStr) / BigInt(10) ** BigInt(decimals)
      return whole.toLocaleString('en-US')
    } catch (e) {
      console.error(`_formatAtomInt: invalid atom string ${JSON.stringify(atomStr)}`, e)
      return '0'
    }
  }

  _formatVARInt(atomStr) {
    return this._formatAtomInt(atomStr, 8)
  }
  _formatSKAInt(atomStr) {
    return this._formatAtomInt(atomStr, 18)
  }
}
