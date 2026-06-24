import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const fakePanels = []
const makeFakePanel = () => ({ render: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() })
vi.mock('../helpers/chart_panel', () => ({
  createChartPanel: vi.fn((el, opts) => {
    const p = makeFakePanel()
    p._el = el
    p._opts = opts
    fakePanels.push(p)
    return p
  })
}))
vi.mock('../helpers/http', () => ({
  requestJSON: vi.fn().mockResolvedValue({
    by_time: { time: ['2024-06-01T22:00:00Z'], yes: [1], abstain: [2], no: [3] },
    by_height: { height: [4096], yes: [1], abstain: [0], no: [0] }
  })
}))

afterEach(() => {
  fakePanels.length = 0
  vi.clearAllMocks()
})

const { default: AgendaController } = await import('./agenda_controller.js')
const { createChartPanel } = await import('../helpers/chart_panel.js')

function makeController() {
  const el = document.createElement('div')
  const ctrl = new AgendaController(el)
  ctrl.cumulativeVoteChoicesTarget = document.createElement('div')
  ctrl.voteChoicesByBlockTarget = document.createElement('div')
  ctrl.cumulativeRangerTarget = document.createElement('div')
  ctrl.blockRangerTarget = document.createElement('div')
  ctrl.hasCumulativeRangerTarget = true
  ctrl.hasBlockRangerTarget = true
  ctrl.data = { get: () => 'activateska2' }
  return ctrl
}

describe('agenda controller', () => {
  it('connect builds two panels (time + block height) and renders each', async () => {
    const ctrl = makeController()
    await ctrl.connect()
    expect(createChartPanel).toHaveBeenCalledTimes(2)
    expect(fakePanels[0]._opts.xTime).toBe(true)
    expect(fakePanels[1]._opts.xTime).toBe(false)
    expect(fakePanels[0].render).toHaveBeenCalledTimes(1)
    expect(fakePanels[1].render).toHaveBeenCalledTimes(1)
    // formatX wiring: time panel formats a date, block panel formats a height
    expect(fakePanels[0]._opts.formatX(1717279200)).toContain('Date:')
    expect(fakePanels[1]._opts.formatX(4096)).toContain('Block Height: 4,096')
  })
  it('disconnect destroys every panel', async () => {
    const ctrl = makeController()
    await ctrl.connect()
    ctrl.disconnect()
    fakePanels.forEach((p) => expect(p.destroy).toHaveBeenCalledTimes(1))
  })
})
