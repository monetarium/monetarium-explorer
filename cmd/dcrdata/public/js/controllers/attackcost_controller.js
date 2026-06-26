import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import TurboQuery from '../helpers/turbolinks_helper'
import globalEventBus from '../services/event_bus_service'
import { loadUPlot, buildOpts } from '../helpers/uplot_adapter'
import { darkEnabled } from '../services/theme_service'

function digitformat(amount, decimalPlaces, noComma) {
  if (!amount) return 0

  if (noComma) return amount.toFixed(decimalPlaces)

  decimalPlaces = decimalPlaces || 0
  const result = parseFloat(amount)
    .toLocaleString(undefined, {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces
    })
    .replace(/\.0*$/, '')
  if (result.indexOf('.') > -1 && result.endsWith('0')) {
    return removeTrailingZeros(result)
  }

  return result
}

function removeTrailingZeros(value) {
  value = value.toString()
  if (value.indexOf('.') === -1) {
    return value
  }

  let cutFrom = value.length - 1
  do {
    if (value[cutFrom] === '0') {
      cutFrom--
    }
  } while (value[cutFrom] === '0')

  if (value[cutFrom] === '.') {
    cutFrom--
  }

  return value.substr(0, cutFrom + 1)
}

function rateCalculation(y) {
  y = y || 0.99
  const x = 1 - y

  return (
    (6 * Math.pow(x, 5) - 15 * Math.pow(x, 4) + 10 * Math.pow(x, 3)) /
    (6 * Math.pow(y, 5) - 15 * Math.pow(y, 4) + 10 * Math.pow(y, 3))
  )
}

const externalAttackType = 'external'
const internalAttackType = 'internal'

const defaultDeviceHashrate = 50 // Th/s
const defaultDevicePower = 1500 // W
const defaultDevicePrice = 1500 // USD
const defaultExchangeRate = 1 // USD/VAR

export default class extends Controller {
  static get targets() {
    return [
      'actualHashRate',
      'attackPercent',
      'attackPeriod',
      'blockHeight',
      'countDevice',
      'deviceHashrate',
      'devicePower',
      'devicePrice',
      'devicePronoun',
      'deviceSuffix',
      'external',
      'internal',
      'internalHash',
      'kwhRate',
      'kwhRateLabel',
      'otherCosts',
      'otherCostsValue',
      'exchangeRate',
      'internalAttackText',
      'targetHashRate',
      'externalAttackText',
      'externalAttackPosText',
      'additionalVar',
      'newTicketPoolValue',
      'internalAttackPosText',
      'additionalHashRate',
      'newHashRate',
      'targetPos',
      'targetPow',
      'ticketAttackSize',
      'ticketPoolAttack',
      'ticketPoolSize',
      'ticketPoolSizeLabel',
      'ticketPoolValue',
      'ticketPrice',
      'tickets',
      'ticketSizeAttack',
      'durationUnit',
      'durationLongDesc',
      'total',
      'totalVarPos',
      'totalDeviceCost',
      'totalElectricity',
      'totalExtraCostRate',
      'totalKwh',
      'totalPos',
      'totalPow',
      'graph',
      'labels',
      'projectedTicketPrice',
      'projectedTicketPriceIncrease',
      'projectedTicketPriceSign',
      'attackType',
      'attackPosPercentAmountLabel',
      'varPriceLabel',
      'totalVarPosLabel',
      'projectedPriceDiv',
      'attackNotPossibleWrapperDiv',
      'coinSupply',
      'totalAttackCostContainer'
    ]
  }

  async connect() {
    this._destroyed = false

    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate([
      'attack_time',
      'target_pow',
      'kwh_rate',
      'other_costs',
      'target_pos',
      'price',
      'device_hashrate',
      'device_power',
      'device_price',
      'attack_type'
    ])

    this.query.update(this.settings)

    this._height = parseInt(this.data.get('height'))
    this._hashrate = parseFloat(this.data.get('hashrate'))
    this._varPrice = defaultExchangeRate
    this._tpPrice = parseFloat(this.data.get('ticketPrice'))
    this._tpValue = parseFloat(this.data.get('ticketPoolValue'))
    this._tpSize = parseInt(this.data.get('ticketPoolSize'))
    this._coinSupply = parseInt(this.data.get('coinSupply'))

    this._deviceHashrate = defaultDeviceHashrate
    this._devicePower = defaultDevicePower
    this._devicePrice = defaultDevicePrice

    this.defaultSettings = {
      attack_time: 1,
      target_pow: 100,
      kwh_rate: 0.1,
      other_costs: 5,
      target_pos: 51,
      price: defaultExchangeRate,
      device_hashrate: defaultDeviceHashrate,
      device_power: defaultDevicePower,
      device_price: defaultDevicePrice,
      attack_type: externalAttackType
    }

    if (this.settings.attack_time) {
      this.attackPeriodTarget.value = parseInt(this.settings.attack_time)
    }
    if (this.settings.target_pow) this.targetPowTarget.value = parseFloat(this.settings.target_pow)
    if (this.settings.kwh_rate) this.kwhRateTarget.value = parseFloat(this.settings.kwh_rate)
    if (this.settings.other_costs) {
      this.otherCostsTarget.value = parseFloat(this.settings.other_costs)
    }
    if (this.settings.target_pos) {
      this.setAllInputs(this.targetPosTargets, parseFloat(this.settings.target_pos))
    }
    if (this.settings.price) {
      this._varPrice = parseFloat(this.settings.price)
      this.exchangeRateTarget.value = this._varPrice
    } else {
      this.exchangeRateTarget.value = defaultExchangeRate
    }
    if (this.settings.device_hashrate) {
      this._deviceHashrate = parseFloat(this.settings.device_hashrate)
      this.deviceHashrateTarget.value = this._deviceHashrate
    }
    if (this.settings.device_power) {
      this._devicePower = parseFloat(this.settings.device_power)
      this.devicePowerTarget.value = this._devicePower
    }
    if (this.settings.device_price) {
      this._devicePrice = parseFloat(this.settings.device_price)
      this.devicePriceTarget.value = this._devicePrice
    }
    if (this.settings.attack_type) this.attackTypeTarget.value = this.settings.attack_type
    if (this.settings.target_pos) {
      this.attackPercentTarget.value = parseFloat(this.targetPosTarget.value) / 100
    }

    if (this.settings.attack_type !== internalAttackType) {
      this.settings.attack_type = externalAttackType
    }
    this.updateSliderData()

    await this._buildChart()

    this.processNightMode = (params) => {
      this._setDark(params.nightMode)
    }
    globalEventBus.on('NIGHT_MODE', this.processNightMode)
    this._onBlock = ({ detail: blockData }) => {
      this._hashrate = blockData.extra.hash_rate
      this.calculate()
    }
    globalEventBus.on('BLOCK_RECEIVED', this._onBlock)
  }

  disconnect() {
    this._destroyed = true
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    globalEventBus.off('BLOCK_RECEIVED', this._onBlock)
    this._destroyChart()
  }

  async _buildChart(dark) {
    const isDark = dark != null ? dark : darkEnabled()
    const UPlot = await loadUPlot()

    this._graphData = []
    this.ratioTable = new Map()

    for (let i = 10; i <= 1000; i += 5) {
      const y = i / 1000
      const x = rateCalculation(y)
      this.ratioTable.set(x, y)
      this._graphData.push([y * this._tpSize, x])
    }

    const xs = this._graphData.map((d) => d[0])
    const ys = this._graphData.map((d) => d[1])

    const def = {
      name: 'attackcost',
      axes: [{ label: 'Hash Power Multiplier' }],
      series: [{ label: 'Hash Power Multiplier', scale: 'y', kind: 'line' }]
    }

    const opts = buildOpts(UPlot, def, {
      dark: isDark,
      width: this.graphTarget.clientWidth || 800,
      height: this.graphTarget.clientHeight || 200,
      xTime: false,
      scaleType: 'log',
      hooks: {
        setCursor: [(u) => this._renderLegend(u)]
      }
    })

    opts.axes[0].label = 'Attacker Tickets'
    opts.axes[0].labelSize = 16
    opts.axes[0].size = 28
    if (opts.axes[1]) {
      opts.axes[1].labelSize = 28
      opts.axes[1].labelGap = 4
      opts.axes[1].labelFont = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    }
    opts.padding = [4, 15, 0, 0]
    opts.cursor = opts.cursor || {}
    opts.cursor.drag = { x: false, y: false }

    this._uplot = new UPlot(opts, [xs, ys], this.graphTarget)
    this._currentDark = isDark

    const clickCb = (e) => this._onChartClick(e)
    this._uplot.over.addEventListener('click', clickCb)
    this._clickCb = clickCb

    window.requestAnimationFrame(() => this.setActivePoint())
  }

  _destroyChart() {
    if (this._uplot) {
      this._uplot.destroy()
      this._uplot = null
    }
  }

  async _setDark(dark) {
    if (this._destroyed) return
    const prevMin = this._uplot && this._uplot.scales.x ? this._uplot.scales.x.min : null
    const prevMax = this._uplot && this._uplot.scales.x ? this._uplot.scales.x.max : null
    this._destroyChart()
    await this._buildChart(dark)
    if (prevMin != null && prevMax != null && isFinite(prevMin) && isFinite(prevMax)) {
      this._uplot.setScale('x', { min: prevMin, max: prevMax })
    }
  }

  _renderLegend(u) {
    const idx = u.cursor.idx
    if (idx == null) return

    const x = u.data[0][idx]
    const y = u.data[1][idx]
    if (y == null) return

    const precision = y >= 1 ? 2 : 6
    const html = `<span>Attacker Tickets: ${digitformat(x, 0)}</span><br><span class="ms-3">Hash Power Multiplier: ${digitformat(y, precision)}x</span>`
    this.labelsTarget.innerHTML = dompurify.sanitize(html)
  }

  _onChartClick(e) {
    const rect = this.graphTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    this._uplot.setCursor({ left: px, top: py })
    const idx = this._uplot.cursor.idx
    if (idx == null) return
    const x = this._uplot.data[0][idx]
    this.attackPercentTarget.value = Math.min(x / this._tpSize, 0.99)
    this.updateSliderData()
  }

  updateQueryString() {
    const [query, settings, defaults] = [{}, this.settings, this.defaultSettings]
    for (const k in settings) {
      if (!settings[k] || settings[k].toString() === defaults[k].toString()) continue
      query[k] = settings[k]
    }
    this.query.replace(query)
  }

  updateAttackTime() {
    this.settings.attack_time = this.attackPeriodTarget.value
    this.updateSliderData()
  }

  updateTargetPow(_e) {
    this.preserveTargetPow = true
    const targetPercentage = parseFloat(_e.currentTarget.value) / 100
    let target = this.ratioTable.get(targetPercentage)
    if (target === undefined) {
      let previousKey = 0
      let previousValue = 0
      this.ratioTable.forEach((value, key) => {
        if (
          (previousKey <= targetPercentage && targetPercentage <= key) ||
          (previousKey >= targetPercentage && targetPercentage >= key)
        ) {
          const gap = Math.abs(key - targetPercentage)
          const preGap = Math.abs(previousKey - targetPercentage)
          if (gap < preGap) {
            target = value
          } else {
            target = previousValue
          }
        }
        previousKey = key
        previousValue = value
      })
    }
    this.attackPercentTarget.value = target
    this.updateSliderData()
  }

  updateDeviceHashrate() {
    const v = parseFloat(this.deviceHashrateTarget.value)
    if (!isFinite(v) || v <= 0) return
    this._deviceHashrate = v
    this.settings.device_hashrate = this.deviceHashrateTarget.value
    this.updateSliderData()
  }

  updateDevicePower() {
    const v = parseFloat(this.devicePowerTarget.value)
    if (!isFinite(v) || v <= 0) return
    this._devicePower = v
    this.settings.device_power = this.devicePowerTarget.value
    this.updateSliderData()
  }

  updateDevicePrice() {
    const v = parseFloat(this.devicePriceTarget.value)
    if (!isFinite(v) || v <= 0) return
    this._devicePrice = v
    this.settings.device_price = this.devicePriceTarget.value
    this.updateSliderData()
  }

  chooseAttackType() {
    this.settings.attack_type = this.selectedAttackType()
    this.updateSliderData()
  }

  updateKwhRate() {
    this.settings.kwh_rate = this.kwhRateTarget.value
    this.updateSliderData()
  }

  updateOtherCosts() {
    this.settings.other_costs = this.otherCostsTarget.value
    this.updateSliderData()
  }

  updateTargetPos(e) {
    this.settings.target_pos = e.currentTarget.value
    this.preserveTargetPoS = true
    this.setAllInputs(this.targetPosTargets, e.currentTarget.value)
    this.updateQueryString()
    this.attackPercentTarget.value = parseFloat(this.targetPosTarget.value) / 100
    this.updateSliderData()
  }

  updatePrice() {
    const v = parseFloat(this.exchangeRateTarget.value)
    if (!isFinite(v) || v <= 0) return
    this._varPrice = v
    this.settings.price = this.exchangeRateTarget.value
    this.updateSliderData()
  }

  selectedAttackType() {
    return this.attackTypeTarget.value
  }

  setActivePoint() {
    if (!this._uplot) return
    const val = Math.min(parseFloat(this.attackPercentTarget.value) || 0, 0.99)
    const targetX = val * this._tpSize
    const xs = this._uplot.data[0]
    if (!xs || !xs.length) return
    let idx = 0
    let best = Math.abs(xs[0] - targetX)
    for (let i = 1; i < xs.length; i++) {
      const d = Math.abs(xs[i] - targetX)
      if (d < best) {
        best = d
        idx = i
      }
    }
    const left = this._uplot.valToPos(this._uplot.data[0][idx], 'x')
    const top = this._uplot.valToPos(this._uplot.data[1][idx], 'y')
    if (left != null && top != null) {
      this._uplot.setCursor({ left, top })
    }
  }

  updateTargetHashRate() {
    const ticketPercentage = parseFloat(this.targetPosTarget.value)
    this.targetHashRate = this._hashrate * rateCalculation(ticketPercentage / 100)
    const powPercentage = (100 * this.targetHashRate) / this._hashrate
    if (!this.preserveTargetPow) {
      this.targetPowTarget.value = digitformat(powPercentage, 2, true)
    } else {
      this.preserveTargetPow = false
    }
    this.setAllValues(this.internalHashTargets, `${digitformat(this.targetHashRate, 8)} Ph/s `)
    switch (this.settings.attack_type) {
      case externalAttackType:
        this.setAllValues(
          this.newHashRateTargets,
          digitformat(this.targetHashRate + this._hashrate, 8)
        )
        this.setAllValues(this.additionalHashRateTargets, digitformat(this.targetHashRate, 8))
        this.projectedPriceDivTarget.style.display = 'block'
        this.internalAttackTextTarget.classList.add('d-none')
        this.internalAttackPosTextTarget.classList.add('d-none')
        this.showAll(this.externalAttackTextTargets)
        this.externalAttackPosTextTarget.classList.remove('d-node')
        break
      case internalAttackType:
      default:
        this.projectedPriceDivTarget.style.display = 'none'
        this.hideAll(this.externalAttackTextTargets)
        this.externalAttackPosTextTarget.classList.add('d-node')
        this.internalAttackTextTarget.classList.remove('d-none')
        this.internalAttackPosTextTarget.classList.remove('d-none')
        break
    }
  }

  updateSliderData() {
    const val = Math.min(parseFloat(this.attackPercentTarget.value) || 0, 0.99)
    if (!this.preserveTargetPoS) {
      this.setAllInputs(this.targetPosTargets, val * 100)
    } else {
      this.preserveTargetPoS = false
    }

    this.updateTargetHashRate()
    this.setActivePoint()

    this.ticketsTarget.innerHTML = `${digitformat(val * this._tpSize)} tickets `
    switch (this.settings.attack_type) {
      case externalAttackType:
        this.hideAll(this.internalAttackPosTextTargets)
        this.showAll(this.externalAttackPosTextTargets)
        break
      case internalAttackType:
      default:
        this.hideAll(this.externalAttackPosTextTargets)
        this.showAll(this.internalAttackPosTextTargets)
    }

    this.calculate(true)
  }

  calculate(disableHashRateUpdate) {
    if (!disableHashRateUpdate) this.updateTargetHashRate()

    this.updateQueryString()
    const deviceCount = Math.ceil((this.targetHashRate * 1000) / this._deviceHashrate)
    const totalDeviceCost = deviceCount * this._devicePrice
    const totalKwh =
      (deviceCount * this._devicePower * parseFloat(this.attackPeriodTarget.value)) / 1000
    const totalElectricity = totalKwh * parseFloat(this.kwhRateTarget.value)
    const extraCost =
      (parseFloat(this.otherCostsTarget.value) / 100) * (totalDeviceCost + totalElectricity)
    const totalPow = extraCost + totalDeviceCost + totalElectricity
    let ticketAttackSize, varNeed
    if (this.settings.attack_type === externalAttackType) {
      varNeed = this._tpValue / (1 - parseFloat(this.targetPosTarget.value) / 100)
      this.setAllValues(this.newTicketPoolValueTargets, digitformat(varNeed, 2))
      this.setAllValues(this.additionalVarTargets, digitformat(varNeed - this._tpValue, 2))
    } else {
      ticketAttackSize = (this._tpSize * parseFloat(this.targetPosTarget.value)) / 100
      varNeed = this._tpValue * (parseFloat(this.targetPosTarget.value) / 100)
      this.setAllValues(this.ticketPoolAttackTargets, digitformat(varNeed))
    }
    const projectedTicketPrice = varNeed / this._tpSize
    this.projectedTicketPriceIncreaseTarget.innerHTML = digitformat(
      (100 * Math.abs(projectedTicketPrice - this._tpPrice)) / this._tpPrice,
      2
    )
    this.projectedTicketPriceSignTarget.innerHTML =
      projectedTicketPrice > this._tpPrice ? 'increase' : 'decrease'
    this.ticketPoolValueTarget.innerHTML = digitformat(this._hashrate, 3)

    const totalVarPos =
      this.settings.attack_type === externalAttackType
        ? varNeed - this._tpValue
        : ticketAttackSize * projectedTicketPrice
    const totalPos = totalVarPos * this._varPrice
    const timeStr = this.attackPeriodTarget.value
    const hourStr = timeStr > 1 ? 'hours' : 'hour'
    const timeHourStr = `${timeStr} ${hourStr}`
    const devicePronounStr = deviceCount > 1 ? 'them' : 'it'
    const deviceSuffixStr = deviceCount > 1 ? 's' : ''
    this.ticketPoolSizeLabelTarget.innerHTML = digitformat(this._tpSize, 2)
    this.setAllValues(this.actualHashRateTargets, digitformat(this._hashrate, 8))
    this.exchangeRateTarget.value = digitformat(this._varPrice, 2, true)
    this.setAllInputs(this.targetPosTargets, digitformat(parseFloat(this.targetPosTarget.value), 2))
    this.ticketPriceTarget.innerHTML = digitformat(this._tpPrice, 4)
    this.setAllValues(this.targetHashRateTargets, digitformat(this.targetHashRate, 8))
    this.setAllValues(this.additionalHashRateTargets, digitformat(this.targetHashRate, 8))
    this.durationUnitTarget.innerHTML = hourStr
    this.setAllValues(this.durationLongDescTargets, timeHourStr)
    this.setAllValues(this.countDeviceTargets, digitformat(deviceCount))
    this.devicePronounTarget.innerHTML = devicePronounStr
    this.deviceSuffixTarget.innerHTML = deviceSuffixStr
    this.setAllValues(this.totalDeviceCostTargets, digitformat(totalDeviceCost))
    this.setAllValues(this.totalKwhTargets, digitformat(totalKwh, 2))
    this.setAllValues(this.totalElectricityTargets, digitformat(totalElectricity, 2))
    this.setAllValues(this.otherCostsValueTargets, digitformat(extraCost, 2))
    this.setAllValues(this.totalPowTargets, digitformat(totalPow, 2))
    this.setAllValues(this.ticketSizeAttackTargets, digitformat(ticketAttackSize))
    this.setAllValues(this.totalVarPosTargets, digitformat(totalVarPos, 2))
    this.setAllValues(this.totalPosTargets, digitformat(totalPos))
    this.setAllValues(this.ticketPoolValueTargets, digitformat(this._tpValue))
    this.setAllValues(this.ticketPoolSizeTargets, digitformat(this._tpSize))
    this.blockHeightTarget.innerHTML = digitformat(this._height)
    this.totalTarget.innerHTML = digitformat(totalPow + totalPos, 2)
    this.projectedTicketPriceTarget.innerHTML = digitformat(projectedTicketPrice, 2)
    this.attackPosPercentAmountLabelTarget.innerHTML = digitformat(this.targetPosTarget.value, 2)
    this.setAllValues(this.totalVarPosLabelTargets, digitformat(totalVarPos, 2))
    this.setAllValues(this.varPriceLabelTargets, digitformat(this._varPrice, 2))
    this.showPosCostWarning(varNeed)
  }

  setAllValues(targets, data) {
    targets.forEach((n) => {
      n.innerHTML = data
    })
  }

  setAllInputs(targets, data) {
    targets.forEach((n) => {
      n.value = data
    })
  }

  hideAll(targets) {
    targets.forEach((el) => el.classList.add('d-none'))
  }

  showAll(targets) {
    targets.forEach((el) => el.classList.remove('d-none'))
  }

  showPosCostWarning(varNeed) {
    const totalVarInCirculation = this._coinSupply / 100000000
    if (varNeed > totalVarInCirculation) {
      this.coinSupplyTarget.textContent = digitformat(totalVarInCirculation, 2)
      this.totalAttackCostContainerTarget.style.cssText = 'color: #f12222 !important'
      this.showAll(this.attackNotPossibleWrapperDivTargets)
    } else {
      this.totalAttackCostContainerTarget.style.cssText = 'color: #6c757d !important'
      this.hideAll(this.attackNotPossibleWrapperDivTargets)
    }
  }
}
