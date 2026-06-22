// Chart registry: resolves a chart name to a ChartDefinition. Static charts are
// registered by name; coin-supply/{n} and fees/{n} are produced by factories
// (one definition shape parameterized by coin type).

const COIN_SUPPLY_RE = /^coin-supply\/(\d+)$/
const SKA_FEE_RE = /^fees\/(\d+)$/

let staticDefs = {}
let coinSupplyFactory = null
let feesFactory = null

export function register(def) {
  staticDefs[def.name] = def
}

export function registerCoinFactories(supplyFactory, feesFactoryFn) {
  coinSupplyFactory = supplyFactory
  feesFactory = feesFactoryFn
}

export function coinTypeFromName(name) {
  if (typeof name !== 'string') return 0
  const sup = COIN_SUPPLY_RE.exec(name)
  if (sup) {
    const n = parseInt(sup[1], 10)
    return n >= 1 && n <= 255 ? n : 0
  }
  const fee = SKA_FEE_RE.exec(name)
  if (fee) {
    const n = parseInt(fee[1], 10)
    return n >= 1 && n <= 255 ? n : 0
  }
  return 0
}

export function isCoinSupplyName(name) {
  return name === 'coin-supply' || (typeof name === 'string' && name.startsWith('coin-supply/'))
}

export function isSKAFeeName(name) {
  return typeof name === 'string' && SKA_FEE_RE.test(name) && coinTypeFromName(name) > 0
}

export function getDefinition(name) {
  if (COIN_SUPPLY_RE.test(name)) {
    return coinSupplyFactory ? coinSupplyFactory(coinTypeFromName(name)) : null
  }
  if (name === 'fees') {
    return feesFactory ? feesFactory(0) : null
  }
  if (SKA_FEE_RE.test(name)) {
    return feesFactory ? feesFactory(coinTypeFromName(name)) : null
  }
  return staticDefs[name] || null
}

// Test-only: clear registrations between cases.
export function _resetRegistry() {
  staticDefs = {}
  coinSupplyFactory = null
  feesFactory = null
}
