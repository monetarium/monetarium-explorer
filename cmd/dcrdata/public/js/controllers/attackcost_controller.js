import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { getDefault } from '../helpers/module_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import globalEventBus from '../services/event_bus_service'

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

let Dygraph // lazy loaded on connect
let height, varPrice, hashrate, tpSize, tpValue, tpPrice, graphData, currentPoint, coinSupply
let deviceHashrate, devicePower, devicePrice

function rateCalculation(y) {
  y = y || 0.99 // 0.99 TODO confirm why 0.99 is used as default instead of 1
  const x = 1 - y

  // Hybrid PoW + PoS deterrence formula for the fixed 50/50 reward split.
  // (6x⁵-15x⁴ +10x³) / (6y⁵-15y⁴ +10y³) where y = stake fraction and x = 1-y
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

function legendFormatter(data) {
  let html = ''
  if (data.x == null) {
    const dashLabels = data.series.reduce((nodes, series) => {
      return `${nodes} <span>${series.labelHTML}</span>`
    }, '')
    html = `<span>${this.getLabels()[0]}: N/A</span>${dashLabels}`
  } else {
    const yVals = data.series.reduce((nodes, series) => {
      if (!series.isVisible) return nodes
      const precession = series.y >= 1 ? 2 : 6
      return `${nodes} <span class="ms-3">${series.labelHTML}: ${digitformat(series.y, precession)}x</span>`
    }, '<br>')

    html = `<span>${this.getLabels()[0]}: ${digitformat(data.x, 0)}</span>${yVals}`
  }
  dompurify.sanitize(html)
  return html
}

function nightModeOptions(nightModeOn) {
  if (nightModeOn) {
    return {
      rangeSelectorAlpha: 0.3,
      gridLineColor: '#596D81',
      colors: ['#2DD8A3', '#2970FF', '#FFC84E']
    }
  }
  return {
    rangeSelectorAlpha: 0.4,
    gridLineColor: '#C4CBD2',
    colors: ['#2970FF', '#006600', '#FF0090']
  }
}

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

    // Get initial view settings from the url
    this.query.update(this.settings)

    height = parseInt(this.data.get('height'))
    hashrate = parseInt(this.data.get('hashrate'))
    varPrice = defaultExchangeRate
    tpPrice = parseFloat(this.data.get('ticketPrice'))
    tpValue = parseFloat(this.data.get('ticketPoolValue'))
    tpSize = parseInt(this.data.get('ticketPoolSize'))
    coinSupply = parseInt(this.data.get('coinSupply'))

    deviceHashrate = defaultDeviceHashrate
    devicePower = defaultDevicePower
    devicePrice = defaultDevicePrice

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
      varPrice = parseFloat(this.settings.price)
      this.exchangeRateTarget.value = varPrice
    } else {
      this.exchangeRateTarget.value = defaultExchangeRate
    }
    if (this.settings.device_hashrate) {
      deviceHashrate = parseFloat(this.settings.device_hashrate)
      this.deviceHashrateTarget.value = deviceHashrate
    }
    if (this.settings.device_power) {
      devicePower = parseFloat(this.settings.device_power)
      this.devicePowerTarget.value = devicePower
    }
    if (this.settings.device_price) {
      devicePrice = parseFloat(this.settings.device_price)
      this.devicePriceTarget.value = devicePrice
    }
    if (this.settings.attack_type) this.attackTypeTarget.value = this.settings.attack_type
    if (this.settings.target_pos) {
      this.attackPercentTarget.value = parseFloat(this.targetPosTarget.value) / 100
    }

    if (this.settings.attack_type !== internalAttackType) {
      this.settings.attack_type = externalAttackType
    }
    this.updateSliderData()

    Dygraph = await getDefault(
      import(/* webpackChunkName: "dygraphs" */ '../vendor/dygraphs.min.js')
    )

    // dygraph does not provide a way to disable zoom on y-axis https://code.google.com/archive/p/dygraphs/issues/384
    // this is a hack as doZoomY_ is marked as private
    Dygraph.prototype.doZoomY_ = function (_lowY, _highY) {}

    this.plotGraph()
    this.processNightMode = (params) => {
      this.chartsView.updateOptions(nightModeOptions(params.nightMode))
    }
    globalEventBus.on('NIGHT_MODE', this.processNightMode)
  }

  disconnect() {
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    if (this.chartsView !== undefined) {
      this.chartsView.destroy()
    }
  }

  plotGraph() {
    const that = this
    graphData = []
    this.ratioTable = new Map()

    // populate graphData
    // to avoid javascript decimal math issue, the iteration is done over whole number and reduced to the expected decimal value within the loop
    for (let i = 10; i <= 1000; i += 5) {
      const y = i / 1000
      const x = rateCalculation(y)
      this.ratioTable.set(x, y)
      graphData.push([y * tpSize, x])
    }

    const options = {
      ...nightModeOptions(false),
      labels: ['Attacker Tickets', 'Hash Power Multiplier'],
      ylabel: 'Hash Power Multiplier',
      xlabel: 'Attacker Tickets',
      axes: {
        y: {
          axisLabelWidth: 70
        }
      },
      highlightSeriesOpts: { strokeWidth: 2 },
      legendFormatter: legendFormatter,
      hideOverlayOnMouseOut: false,
      labelsDiv: this.labelsTarget,
      labelsSeparateLines: true,
      showRangeSelector: false,
      labelsKMB: true,
      legend: 'always',
      logscale: true,
      interactionModel: {
        click: function (_e) {
          that.attackPercentTarget.value = currentPoint.x
          that.updateSliderData()
        }
      },
      highlightCallback: function (event, x, p) {
        currentPoint = p[0]
      }
    }

    this.chartsView = new Dygraph(this.graphTarget, graphData, options)
    this.chartsView.setAnnotations([
      {
        series: 'Hashpower multiplier',
        x: 0.51,
        shortText: 'L',
        text: '51% Attack'
      }
    ])
    this.setActivePoint()
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
    deviceHashrate = v
    this.settings.device_hashrate = this.deviceHashrateTarget.value
    this.updateSliderData()
  }

  updateDevicePower() {
    const v = parseFloat(this.devicePowerTarget.value)
    if (!isFinite(v) || v <= 0) return
    devicePower = v
    this.settings.device_power = this.devicePowerTarget.value
    this.updateSliderData()
  }

  updateDevicePrice() {
    const v = parseFloat(this.devicePriceTarget.value)
    if (!isFinite(v) || v <= 0) return
    devicePrice = v
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
    varPrice = v
    this.settings.price = this.exchangeRateTarget.value
    this.updateSliderData()
  }

  selectedAttackType() {
    return this.attackTypeTarget.value
  }

  setActivePoint() {
    // Shows point whose details appear on the legend.
    if (this.chartsView !== undefined) {
      const val = Math.min(parseFloat(this.attackPercentTarget.value) || 0, 0.99)
      const row = this.chartsView.getRowForX(val * tpSize)
      this.chartsView.setSelection(row)
    }
  }

  updateTargetHashRate() {
    const ticketPercentage = parseFloat(this.targetPosTarget.value)
    this.targetHashRate = hashrate * rateCalculation(ticketPercentage / 100)
    const powPercentage = (100 * this.targetHashRate) / hashrate
    if (!this.preserveTargetPow) {
      this.targetPowTarget.value = digitformat(powPercentage, 2, true)
    } else {
      this.preserveTargetPow = false
    }
    this.setAllValues(this.internalHashTargets, `${digitformat(this.targetHashRate, 4)} Ph/s `)
    switch (this.settings.attack_type) {
      case externalAttackType:
        this.setAllValues(this.newHashRateTargets, digitformat(this.targetHashRate + hashrate, 4))
        this.setAllValues(this.additionalHashRateTargets, digitformat(this.targetHashRate, 4))
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
    // Makes PoS to be affected by the slider
    // Target PoS value increases when slider moves to the right
    if (!this.preserveTargetPoS) {
      this.setAllInputs(this.targetPosTargets, val * 100)
    } else {
      this.preserveTargetPoS = false
    }

    this.updateTargetHashRate()
    this.setActivePoint()

    this.ticketsTarget.innerHTML = `${digitformat(val * tpSize)} tickets `
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
    const deviceCount = Math.ceil((this.targetHashRate * 1000) / deviceHashrate)
    const totalDeviceCost = deviceCount * devicePrice
    const totalKwh = (deviceCount * devicePower * parseFloat(this.attackPeriodTarget.value)) / 1000
    const totalElectricity = totalKwh * parseFloat(this.kwhRateTarget.value)
    const extraCost =
      (parseFloat(this.otherCostsTarget.value) / 100) * (totalDeviceCost + totalElectricity)
    const totalPow = extraCost + totalDeviceCost + totalElectricity
    let ticketAttackSize, varNeed
    if (this.settings.attack_type === externalAttackType) {
      varNeed = tpValue / (1 - parseFloat(this.targetPosTarget.value) / 100)
      this.setAllValues(this.newTicketPoolValueTargets, digitformat(varNeed, 2))
      this.setAllValues(this.additionalVarTargets, digitformat(varNeed - tpValue, 2))
    } else {
      ticketAttackSize = (tpSize * parseFloat(this.targetPosTarget.value)) / 100
      varNeed = tpValue * (parseFloat(this.targetPosTarget.value) / 100)
      this.setAllValues(this.ticketPoolAttackTargets, digitformat(varNeed))
    }
    const projectedTicketPrice = varNeed / tpSize
    this.projectedTicketPriceIncreaseTarget.innerHTML = digitformat(
      (100 * Math.abs(projectedTicketPrice - tpPrice)) / tpPrice,
      2
    )
    this.projectedTicketPriceSignTarget.innerHTML =
      projectedTicketPrice > tpPrice ? 'increase' : 'decrease'
    this.ticketPoolValueTarget.innerHTML = digitformat(hashrate, 3)

    const totalVarPos =
      this.settings.attack_type === externalAttackType
        ? varNeed - tpValue
        : ticketAttackSize * projectedTicketPrice
    const totalPos = totalVarPos * varPrice
    const timeStr = this.attackPeriodTarget.value
    const hourStr = timeStr > 1 ? 'hours' : 'hour'
    const timeHourStr = `${timeStr} ${hourStr}`
    const devicePronounStr = deviceCount > 1 ? 'them' : 'it'
    const deviceSuffixStr = deviceCount > 1 ? 's' : ''
    this.ticketPoolSizeLabelTarget.innerHTML = digitformat(tpSize, 2)
    this.setAllValues(this.actualHashRateTargets, digitformat(hashrate, 4))
    this.exchangeRateTarget.value = digitformat(varPrice, 2)
    this.setAllInputs(this.targetPosTargets, digitformat(parseFloat(this.targetPosTarget.value), 2))
    this.ticketPriceTarget.innerHTML = digitformat(tpPrice, 4)
    this.setAllValues(this.targetHashRateTargets, digitformat(this.targetHashRate, 4))
    this.setAllValues(this.additionalHashRateTargets, digitformat(this.targetHashRate, 4))
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
    this.setAllValues(this.ticketPoolValueTargets, digitformat(tpValue))
    this.setAllValues(this.ticketPoolSizeTargets, digitformat(tpSize))
    this.blockHeightTarget.innerHTML = digitformat(height)
    this.totalTarget.innerHTML = digitformat(totalPow + totalPos, 2)
    this.projectedTicketPriceTarget.innerHTML = digitformat(projectedTicketPrice, 2)
    this.attackPosPercentAmountLabelTarget.innerHTML = digitformat(this.targetPosTarget.value, 2)
    this.setAllValues(this.totalVarPosLabelTargets, digitformat(totalVarPos, 2))
    this.setAllValues(this.varPriceLabelTargets, digitformat(varPrice, 2))
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
    const totalVarInCirculation = coinSupply / 100000000
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
