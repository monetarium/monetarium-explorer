import { describe, it, expect } from 'vitest'
import {
  PALETTE,
  OTHERS_COLOR,
  colorForIndex,
  seriesStroke,
  seriesFill,
  chartColors,
  seriesColorByKey,
  hexToRgba
} from './chart_theme'

describe('colorForIndex', () => {
  it('is deterministic and wraps the palette', () => {
    expect(colorForIndex(0)).toBe('#2970FF')
    expect(colorForIndex(1)).toBe('#E03131')
    expect(colorForIndex(PALETTE.length)).toBe('#2970FF') // wraps
  })

  it('swaps index 0 to mint in dark mode (the primary series color)', () => {
    expect(colorForIndex(0, true)).toBe('#2DD8A3')
    expect(colorForIndex(0, false)).toBe('#2970FF')
  })

  it('defaults to the light value so theme-agnostic callers (the pie) are unaffected', () => {
    expect(colorForIndex(0)).toBe('#2970FF')
  })

  it('is theme-agnostic for every index except 0', () => {
    for (let i = 1; i < PALETTE.length; i++) {
      expect(colorForIndex(i, true)).toBe(colorForIndex(i, false))
    }
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

  it('returns the dark primary for index 0 in dark mode', () => {
    expect(seriesStroke(0, true)).toBe('#2DD8A3')
  })
})

describe('seriesFill', () => {
  it('returns a translucent rgba of the palette color, stronger (more opaque) in dark mode', () => {
    expect(seriesFill(0, false)).toBe('rgba(41, 112, 255, 0.12)')
    expect(seriesFill(0, true)).toBe('rgba(41, 112, 255, 0.18)')
  })
})

describe('hexToRgba', () => {
  it('converts a #rrggbb hex to an rgba() string at the given alpha', () => {
    expect(hexToRgba('#2970ff', 0.55)).toBe('rgba(41, 112, 255, 0.55)')
    expect(hexToRgba('#2dd8a3', 0.14)).toBe('rgba(45, 216, 163, 0.14)')
    expect(hexToRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)')
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

describe('seriesColorByKey', () => {
  it('returns the light color for a known key', () => {
    expect(seriesColorByKey('tickets-price', false)).toBe('#2970ff')
  })
  it('returns the dark color for a known key', () => {
    expect(seriesColorByKey('tickets-price', true)).toBe('#2dd8a3')
  })
  it('returns the light color for tickets-bought', () => {
    expect(seriesColorByKey('tickets-bought', false)).toBe('#006666')
  })
  it('returns null for an unknown key', () => {
    expect(seriesColorByKey('unknown', false)).toBeNull()
  })
})
