import { describe, it, expect } from 'vitest'
import uPlot from 'uplot'

// Guards that the dependency is installed and exposes the static path builders
// the adapter relies on (uPlot.paths.bars / .stepped / .linear).
describe('uplot dependency', () => {
  it('default-exports the uPlot constructor', () => {
    expect(typeof uPlot).toBe('function')
  })

  it('exposes the path builders the adapter uses', () => {
    expect(typeof uPlot.paths.bars).toBe('function')
    expect(typeof uPlot.paths.stepped).toBe('function')
    expect(typeof uPlot.paths.linear).toBe('function')
  })
})
