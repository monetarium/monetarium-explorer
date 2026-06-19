import { describe, it, expect } from 'vitest'
import {
  PALETTE,
  OTHERS_COLOR,
  colorForIndex,
  seriesStroke,
  seriesFill,
  chartColors
} from './chart_theme'

describe('colorForIndex', () => {
  it('is deterministic and wraps the palette', () => {
    expect(colorForIndex(0)).toBe('#2970FF')
    expect(colorForIndex(1)).toBe('#E03131')
    expect(colorForIndex(PALETTE.length)).toBe('#2970FF') // wraps
  })
})

describe('palette constants', () => {
  it('exposes a 25-color palette and the grey Others color', () => {
    expect(PALETTE).toHaveLength(25)
    expect(OTHERS_COLOR).toBe('#adb5bd')
  })
})

describe('seriesStroke', () => {
  it('returns the palette color for the series index', () => {
    expect(seriesStroke(0)).toBe('#2970FF')
    expect(seriesStroke(1)).toBe('#E03131')
  })
})

describe('seriesFill', () => {
  it('returns a translucent rgba of the palette color, stronger (more opaque) in dark mode', () => {
    expect(seriesFill(0, false)).toBe('rgba(41, 112, 255, 0.12)')
    expect(seriesFill(0, true)).toBe('rgba(41, 112, 255, 0.18)')
  })
})

describe('chartColors', () => {
  it('returns the light token set', () => {
    expect(chartColors(false).tooltipBg).toBe('#ffffff')
    expect(chartColors(false).axis).toBe('#2d2d2d')
  })
  it('returns the dark token set', () => {
    expect(chartColors(true).tooltipBg).toBe('#292929')
    expect(chartColors(true).axis).toBe('#b6b6b6')
  })
})
