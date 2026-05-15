import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub the @hotwired/stimulus import so the controller module loads in jsdom.
vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const { default: AddressController, flowVisibility } = await import('./address_controller.js')

// ---------------------------------------------------------------------------
// Fake Dygraph that reproduces the real range-selector invariant.
//
// dygraphs' computeCombinedSeriesAndLimits_ does `for (t = 0; t < d[0].length;
// t++)` where `d` only holds the *visible* series. When zero series are
// visible, `d` is empty and `d[0]` is undefined, throwing
// "Cannot read properties of undefined (reading 'length')". Every setVisibility
// call triggers predraw_, so any transient all-invisible state crashes.
//
// This fake mirrors that: it applies visibility, then on each redraw throws if
// no series are visible. The (idx, val) form redraws per call (the old buggy
// path); the object-map form applies everything then redraws once (the fix).
// ---------------------------------------------------------------------------
function makeFakeGraph(initialVisibility) {
  const vis = [...initialVisibility]
  const graph = {}
  graph.vis = vis
  graph.redrawCount = 0
  graph.setVisibilityCalls = []
  graph._redraw = function () {
    graph.redrawCount++
    // Mirror computeCombinedSeriesAndLimits_: it builds `d` from visible
    // series only and then dereferences `d[0].length`. With zero visible
    // series that throws "Cannot read properties of undefined".
    const d = vis.filter((v) => v).map(() => [[0, 0]])
    if (d.length === 0) {
      throw new TypeError("Cannot read properties of undefined (reading 'length')")
    }
  }
  graph.setVisibility = function (t, e) {
    graph.setVisibilityCalls.push([t, e])
    if (t !== null && typeof t === 'object' && !Array.isArray(t)) {
      for (const n in t) vis[n] = t[n]
    } else {
      vis[t] = e
    }
    graph._redraw()
  }
  return graph
}

function makeBoxes(state) {
  // state: { received, sent, net } booleans
  const boxes = [
    { value: '2', checked: !!state.sent },
    { value: '1', checked: !!state.received },
    { value: '4', checked: !!state.net }
  ]
  boxes.forEach = Array.prototype.forEach.bind(boxes)
  return boxes
}

function makeController(graph, boxes) {
  const ctrl = new AddressController(document.createElement('div'))
  ctrl.graph = graph
  ctrl.flowBoxes = boxes
  ctrl.settings = {}
  ctrl.query = { replace: vi.fn() }
  return ctrl
}

describe('flowVisibility', () => {
  it('maps Received only (bit 1)', () => {
    expect(flowVisibility(1)).toEqual({ 0: true, 1: false, 2: false, 3: false })
  })

  it('maps Sent only (bit 2)', () => {
    expect(flowVisibility(2)).toEqual({ 0: false, 1: true, 2: false, 3: false })
  })

  it('maps Net only (bit 4) onto both net series', () => {
    expect(flowVisibility(4)).toEqual({ 0: false, 1: false, 2: true, 3: true })
  })

  it('maps Received + Net', () => {
    expect(flowVisibility(5)).toEqual({ 0: true, 1: false, 2: true, 3: true })
  })

  it('maps all three checked', () => {
    expect(flowVisibility(7)).toEqual({ 0: true, 1: true, 2: true, 3: true })
  })

  it('returns booleans, never raw bitmask numbers', () => {
    for (const v of Object.values(flowVisibility(4))) {
      expect(typeof v).toBe('boolean')
    }
  })
})

describe('updateFlow range-selector regression', () => {
  let graph

  beforeEach(() => {
    // Default chart state: only Received (series 0) visible.
    graph = makeFakeGraph([true, false, false, false])
  })

  it('does not change the graph when all boxes are unchecked', () => {
    const ctrl = makeController(graph, makeBoxes({ received: false, sent: false, net: false }))
    expect(() => ctrl.updateFlow()).not.toThrow()
    expect(graph.vis).toEqual([true, false, false, false])
    expect(graph.setVisibilityCalls).toHaveLength(0)
  })

  it('uncheck Received then check Net does not crash the range selector', () => {
    // Step 1: user unchecks Received (everything off) — early return, desync.
    const ctrl = makeController(graph, makeBoxes({ received: false, sent: false, net: false }))
    ctrl.updateFlow()
    expect(graph.vis).toEqual([true, false, false, false]) // graph untouched

    // Step 2: user checks Net. This is the reported crash sequence.
    ctrl.flowBoxes = makeBoxes({ received: false, sent: false, net: true })
    expect(() => ctrl.updateFlow()).not.toThrow()

    expect(graph.vis).toEqual([false, false, true, true])
    // Atomic: a single setVisibility call with an object map, one redraw —
    // never a transient all-invisible predraw.
    expect(graph.setVisibilityCalls).toHaveLength(1)
    expect(typeof graph.setVisibilityCalls[0][0]).toBe('object')
    expect(graph.redrawCount).toBe(1)
  })

  it('persists the bitmap to settings/query when flow changes', () => {
    const ctrl = makeController(graph, makeBoxes({ received: true, sent: false, net: true }))
    ctrl.updateFlow()
    expect(ctrl.settings.flow).toBe(5)
    expect(ctrl.query.replace).toHaveBeenCalledWith(ctrl.settings)
    expect(graph.vis).toEqual([true, false, true, true])
  })
})
