import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'

export default class extends Controller {
  static get targets() {
    return [
      'coinSupply',
      'mixedPct',
      'devFund',
      'bsubsidyDev',
      'convertedDev',
      'convertedSupply',
      'convertedDevSub',
      'exchangeRate'
    ]
  }

  handleBlock({ detail: blockData }) {
    const ex = blockData.extra
    this.coinSupplyTarget.innerHTML = humanize.decimalParts(ex.coin_supply / 100000000, true, 0)
    this.mixedPctTarget.innerHTML = ex.mixed_percent.toFixed(0)
    this.bsubsidyDevTarget.innerHTML = humanize.decimalParts(
      ex.subsidy.dev / 100000000,
      false,
      8,
      2
    )

    const treasuryTotal = ex.dev_fund + ex.treasury_bal.balance
    this.devFundTarget.innerHTML = humanize.decimalParts(treasuryTotal / 100000000, true, 0)

    if (ex.exchange_rate) {
      const { value: xcRate, index } = ex.exchange_rate
      if (this.hasConvertedDevTarget) {
        this.convertedDevTarget.textContent = `${humanize.threeSigFigs((treasuryTotal / 1e8) * xcRate)} ${index}`
      }
      if (this.hasConvertedSupplyTarget) {
        this.convertedSupplyTarget.textContent = `${humanize.threeSigFigs((ex.coin_supply / 1e8) * xcRate)} ${index}`
      }
      if (this.hasConvertedDevSubTarget) {
        this.convertedDevSubTarget.textContent = `${humanize.twoDecimals((ex.subsidy.dev / 1e8) * xcRate)} ${index}`
      }
      if (this.hasExchangeRateTarget) {
        this.exchangeRateTarget.textContent = humanize.twoDecimals(xcRate)
      }
    }
  }
}
