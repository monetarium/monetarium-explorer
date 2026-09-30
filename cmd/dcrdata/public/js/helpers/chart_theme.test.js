import { describe, it, expect, vi } from 'vitest'
import {
  PALETTE,
  CURATED_RANKS,
  LOOP_HUE_STEP,
  colorForIndex,
  resolveSwatchColors,
  hexToHsl,
  hslToHex,
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
  it('exposes a 25-color palette', () => {
    expect(PALETTE).toHaveLength(25)
    expect(CURATED_RANKS).toBe(25)
  })
  it('rotates 5 degrees per loop, the step that quantizes cleanly', () => {
    // 7 and 11 degrees were measured to collide MORE often, not less: a bigger
    // step is likelier to land on another rank's 8-bit RGB byte.
    expect(LOOP_HUE_STEP).toBe(5)
  })
})

describe('hexToHsl / hslToHex', () => {
  it('round-trips a palette color', () => {
    for (const hex of PALETTE) {
      const [h, s, l] = hexToHsl(hex)
      expect(hslToHex(h, s, l)).toBe(hex)
    }
  })
  it('reads a known color in HSL', () => {
    const [h, s, l] = hexToHsl('#2970FF')
    expect(h).toBeCloseTo(220, 0)
    expect(s).toBeCloseTo(100, 0)
    expect(l).toBeCloseTo(58, 0)
  })
})

describe('resolveSwatchColors', () => {
  // The requirement this function exists for: every ranked miner gets its own
  // color, no grey bucket, no cap. Mainnet had 76 reward addresses as of
  // 30 Sep 2026 and the count is not bounded by anything, so the uniqueness
  // assertion is run far past it.
  const UNIQUENESS_RANKS = 2000

  it('hands out the curated palette verbatim for the first 25 ranks', () => {
    // Frozen, because these are the colors the pie has always drawn and the
    // charts.scss visibility swatches are keyed to PALETTE indices.
    expect(resolveSwatchColors(CURATED_RANKS)).toEqual(PALETTE)
  })

  it('never repeats a color, at any rank count up to 2000 miners', () => {
    const colors = resolveSwatchColors(UNIQUENESS_RANKS)
    expect(colors).toHaveLength(UNIQUENESS_RANKS)
    expect(new Set(colors).size).toBe(UNIQUENESS_RANKS)
  })

  it('returns one color per rank and is deterministic', () => {
    expect(resolveSwatchColors(120)).toEqual(resolveSwatchColors(120))
    expect(resolveSwatchColors(0)).toEqual([])
  })

  it('reuses the same palette entries one loop later, nudged in hue', () => {
    // The nudge is a hue rotation, so this asserts the hue actually moved by
    // about one step — not the exact value, because 8-bit rounding costs the
    // low-chroma entries their share of it: #495057 sits at 9% saturation and
    // comes back 4.3 deg rather than 5.0. The contract is "same palette, turned
    // a few degrees", and that is what the bounds below pin.
    const colors = resolveSwatchColors(CURATED_RANKS * 3)
    for (let i = 0; i < CURATED_RANKS; i++) {
      const base = hexToHsl(PALETTE[i])[0]
      const oneLoop = hexToHsl(colors[CURATED_RANKS + i])[0] - base
      const twoLoops = hexToHsl(colors[CURATED_RANKS * 2 + i])[0] - base
      expect(oneLoop).toBeGreaterThan(LOOP_HUE_STEP - 1.5)
      expect(oneLoop).toBeLessThan(LOOP_HUE_STEP + 0.5)
      expect(twoLoops).toBeGreaterThan(LOOP_HUE_STEP * 2 - 1.5)
      expect(twoLoops).toBeLessThan(LOOP_HUE_STEP * 2 + 0.5)
    }
  })

  it('keeps every rank its own value in the mainnet-scale range too', () => {
    // 76 addresses is what mainnet actually has; asserted on its own so a
    // regression at the real size is not hidden by a larger sweep.
    const colors = resolveSwatchColors(76)
    expect(new Set(colors).size).toBe(76)
    expect(colors.slice(0, CURATED_RANKS)).toEqual(PALETTE)
  })

  // The collision path is not hypothetical, so it is exercised rather than
  // asserted unreachable. LOOP_HUE_STEP is 5 deg and 360/5 = 72 loops, so at
  // rank 1801 the 72nd pass rotates PALETTE[0] by a full turn and lands exactly
  // back on the curated color — the first rank whose plain rotation is already
  // taken. Everything below stays quiet.
  it('stays quiet while every rank gets its plain hue rotation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const colors = resolveSwatchColors(1800)
      expect(new Set(colors).size).toBe(1800)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('escalates past the hue rotation, warns, and still returns distinct colors', () => {
    // The reviewer's catch: a rank whose rotation is taken must not be handed
    // the duplicate anyway. It escalates, it tells the console, and the list it
    // returns is still distinct.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const colors = resolveSwatchColors(2000)
      expect(new Set(colors).size).toBe(2000)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toMatch(/collision/i)
    } finally {
      warn.mockRestore()
    }
  })

  it('holds at 5000 ranks, where the ladder is genuinely worked', () => {
    // The 2000-rank case above only climbs to rung 380 of 770. Collisions
    // accumulate with the rank count, so this one is what actually exercises the
    // deep end of the ladder — measured deepest rung is 722 of 770, i.e. 94% of
    // it consumed, with nothing exhausted. That is the evidence for the ladder's
    // size: it is not oversized, and 2000 ranks alone would not have shown it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const colors = resolveSwatchColors(5000)
      expect(colors).toHaveLength(5000)
      expect(new Set(colors).size).toBe(5000)
      // The warning must not escalate to the exhaustion path: nothing here
      // should claim a duplicate, and the single collision warning is expected.
      expect(warn.mock.calls.every((c) => !/duplicate/i.test(c[0]))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('does NOT claim to be distinguishable: loops are siblings, and that is the cost', () => {
    // The tradeoff, pinned so it cannot quietly regress. Uniqueness here is
    // uniqueness of VALUE: a rank and its next loop are the same color to the
    // eye (~1 ΔE00 apart), which is the accepted cost of reusing 25 colors. These
    // assertions therefore pin the near-equality, not a separation: they say
    // "same saturation, hue within one step, different value". Anyone who later
    // raises LOOP_HUE_STEP enough to make loops genuinely distinguishable has to
    // come back here and decide whether losing the grouping cue was intended.
    const colors = resolveSwatchColors(CURATED_RANKS * 3)
    for (let i = 0; i < CURATED_RANKS; i++) {
      const [h0, s0] = hexToHsl(colors[i])
      const [h1, s1] = hexToHsl(colors[CURATED_RANKS + i])
      expect(colors[CURATED_RANKS + i]).not.toBe(colors[i]) // different value
      expect(s1).toBeCloseTo(s0, 0) // same chroma: a sibling, not a stranger
      expect(Math.abs(h1 - h0)).toBeLessThanOrEqual(LOOP_HUE_STEP + 1)
    }
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
  it('returns the lighter-blue dark secondary for tickets-bought (legible on the dark canvas)', () => {
    expect(seriesColorByKey('tickets-bought', true)).toBe('#4dabf7')
  })
  it('returns the lighter-blue dark secondary for hashrate-miners (legible on the dark canvas)', () => {
    expect(seriesColorByKey('hashrate-miners', true)).toBe('#4dabf7')
  })
  it('returns null for an unknown key', () => {
    expect(seriesColorByKey('unknown', false)).toBeNull()
  })
})
