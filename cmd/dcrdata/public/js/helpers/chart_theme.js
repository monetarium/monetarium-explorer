// Shared chart design tokens — the single source of truth for the colors used by
// BOTH the uPlot charts (helpers/uplot_adapter.js) and the hand-rolled SVG
// hashrate-shares pie (controllers/hashrate_shares_controller.js).

// Fixed 25-color categorical palette (visually distinct in light and dark themes).
export const PALETTE = [
  '#2970FF',
  '#E03131',
  '#2DB35E',
  '#F08C00',
  '#1098AD',
  '#7048E8',
  '#E64980',
  '#0B7285',
  '#F59F00',
  '#495057',
  '#4263EB',
  '#74B816',
  '#D6336C',
  '#1864AB',
  '#9C36B5',
  '#0CA678',
  '#E8590C',
  '#3B5BDB',
  '#66A80F',
  '#C2255C',
  '#5C940D',
  '#A61E4D',
  '#364FC7',
  '#087F5B',
  '#862E9C'
]

// Index 0 is the page's PRIMARY series color, not a fixed swatch. On the dark chart
// canvas the light-mode blue (#2970FF) sits at ~2.4:1 — below the 3:1 floor for
// graphical objects — so dark mode swaps to the same mint the named series
// (tickets-price, hashrate-rate) already use, keeping every primary line consistent and
// legible. Only index 0 is theme-aware; every other index returns its fixed PALETTE
// entry regardless of `dark`. `dark` defaults to false so theme-agnostic callers (the
// hashrate-shares page, which resolves swatches with no theme argument) are unaffected.
const PRIMARY = { light: PALETTE[0], dark: '#2DD8A3' }

export function colorForIndex(i, dark = false) {
  const idx = i % PALETTE.length
  if (idx === 0) return dark ? PRIMARY.dark : PRIMARY.light
  return PALETTE[idx]
}

// ---------------------------------------------------------------------------
// hashrate-shares swatches: one color per ranked miner, however many there are
// ---------------------------------------------------------------------------
// The ranked miner list is unbounded — 76 reward addresses on mainnet as of
// 30 Sep 2026, no cap in the data or the API — so a fixed 25-color palette
// cannot color it. Past the palette every row used to land in a single grey
// bucket, which reads as "these rows are all one thing", and the reader it
// hurts most is exactly the one the page exists for: a miner scanning for their
// own row.
//
// So the palette repeats, one full pass per loop, and each pass is nudged
// LOOP_HUE_STEP degrees of hue away from the last: rank 26 is PALETTE[0] rotated
// 5 deg, rank 51 is PALETTE[0] rotated 10 deg, and so on. The page keeps the look
// of the same 25 colors, every rank gets its own value, and nothing has to be
// regenerated when the address count grows.
//
// THE TRADEOFF, STATED PLAINLY. This buys uniqueness of VALUE, not
// distinguishability of COLOR. Two ranks one loop apart are ~1 CIEDE2000 apart —
// measurably different numbers, effectively the same color to the eye. So on a
// 76-row page, rank 1 and rank 26 read as "the same blue", and the swatch alone
// cannot tell them apart. That is the deliberate price of reusing 25 curated
// colors instead of curating more, and it is accepted for now: the rank number,
// the percentage and the address identify a row, the pie's wedge number
// disambiguates a wedge, and ?address= scrolls to and highlights the row. The
// swatch is a visual grouping cue, never the identifier.
//
// The alternative, if that ceiling is ever reached, is a curated palette long
// enough that loops stop being siblings. That is a real list to design, review
// and keep in sync, and 25 colors was the chosen budget; the cost above is
// legibility, the benefit is that nothing on the page looks like a duplicate.
// For scale: the worst pair among the curated 25 themselves is 3.5 ΔE00
// (#4263EB vs #3B5BDB) — this palette already tolerates near-neighbors, it just
// does so by hand rather than by rotation.
//
// The rotation is done in HSL rather than Lab on purpose. A Lab rotation holds
// lightness by rotating the chroma vector, which for the gamut-edge colors in
// this palette (the yellows and oranges, and the near-grey #495057 at 9%
// saturation) has to pull chroma back in to stay inside sRGB — and that
// pull-back collapses adjacent rotations onto the same 8-bit RGB. HSL is in
// gamut at any hue, so the nudge never does that.
//
// LOOP_HUE_STEP is 5 deg because it is the step that quantizes cleanly: at 7 or
// 11 deg a rotation lands on the same RGB byte as another rank's more often
// than at 5. Even so, uniqueness is not left to the arithmetic — resolveSwatchColors
// verifies every value it hands out and escalates on a collision (see the ladder
// below), so the no-duplicates property is a property of the code.
export const CURATED_RANKS = PALETTE.length
export const LOOP_HUE_STEP = 5

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// hexToHsl / hslToHex are the standard round trip, with h in [0,360) and s,l as
// percentages. Exported because the tests assert the rotation in these terms.
export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }
  return [h, s * 100, l * 100]
}

export function hslToHex(h, s, l) {
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const rgb = [0, 0, 0]
  if (hp < 1) {
    rgb[0] = c
    rgb[1] = x
  } else if (hp < 2) {
    rgb[0] = x
    rgb[1] = c
  } else if (hp < 3) {
    rgb[1] = c
    rgb[2] = x
  } else if (hp < 4) {
    rgb[1] = x
    rgb[2] = c
  } else if (hp < 5) {
    rgb[0] = x
    rgb[2] = c
  } else {
    rgb[0] = c
    rgb[2] = x
  }
  const m = ln - c / 2
  const hex = rgb
    .map((v) =>
      Math.round(clamp(v + m, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase()
  return `#${hex}`
}

// The escape ladder for a value that has already been handed out. Hue first,
// in half-degree steps: that is the common case, two rotations of the same base
// landing on the same RGB byte. Then saturation, because the near-grey palette
// entries have almost no hue resolution to give. Then lightness, which is the
// coarsest but always-available axis.
const HUE_ATTEMPTS = 720
const SAT_STEP = 2
const SAT_ATTEMPTS = 15
const LIGHT_STEP = 1
const LIGHT_ATTEMPTS = 20
const LADDER_LENGTH = HUE_ATTEMPTS + SAT_STEP * SAT_ATTEMPTS + LIGHT_ATTEMPTS

// Sizing: 25 bases x (720 hue + 15 saturation + 20 lightness) candidates, and
// the ladder resolves every collision that 10000 ranks produce (the point where
// loop rotations start wrapping onto each other). The tests assert uniqueness
// at 2000 ranks, ~26x the live address count.
function swatchCandidate(hue, s, l, attempt) {
  if (attempt < HUE_ATTEMPTS) return hslToHex(hue + (attempt + 1) * 0.5, s, l)
  const afterHue = attempt - HUE_ATTEMPTS
  if (afterHue < SAT_STEP * SAT_ATTEMPTS) {
    // Alternate the sign so the ladder explores both sides of the base's chroma.
    const step = Math.floor(afterHue / 2) + 1
    return hslToHex(hue, s + (afterHue % 2 === 0 ? SAT_STEP * step : -SAT_STEP * step), l)
  }
  return hslToHex(hue, s, l - LIGHT_STEP * (afterHue - SAT_STEP * SAT_ATTEMPTS + 1))
}

// resolveSwatchColors returns one color per rank from 1 to maxRank, as an array
// indexed by rank - 1. Ranks 1..CURATED_RANKS are the curated palette verbatim,
// so the top of the leaderboard keeps exactly the colors it has always had —
// which is also what keeps the pie and the table in agreement for those ranks.
// Later ranks repeat the palette one loop at a time, each loop rotated further
// in hue, and every returned value is distinct from every other.
//
// Call it once per dataset, not per render: the uniqueness walk is over the rank
// range, so a caller that re-derives colors for a filtered subset could hand the
// same rank a different value depending on what else is on screen.
//
// The uniqueness guarantee is tested at 2000 ranks rather than claimed as
// infinite: the ladder has a finite number of candidates per base, and a rank
// count that exhausted it would be ~5 orders of magnitude past any real list.
export function resolveSwatchColors(maxRank) {
  const colors = []
  const issued = new Set(PALETTE)
  for (let rank = 1; rank <= maxRank; rank++) {
    const base = PALETTE[(rank - 1) % CURATED_RANKS]
    const loop = Math.floor((rank - 1) / CURATED_RANKS)
    if (loop === 0) {
      colors.push(base)
      continue
    }
    const [h, s, l] = hexToHsl(base)
    const hue = (h + loop * LOOP_HUE_STEP) % 360
    let hex = hslToHex(hue, s, l)
    for (let i = 0; issued.has(hex) && i < LADDER_LENGTH; i++) {
      hex = swatchCandidate(hue, s, l, i)
    }
    issued.add(hex)
    colors.push(hex)
  }
  return colors
}

export function seriesStroke(i, dark = false) {
  return colorForIndex(i, dark)
}

// Translucent fill for area/bar series; slightly stronger in dark mode to stay visible.
export function seriesFill(i, dark) {
  return hexToRgba(colorForIndex(i), dark ? 0.18 : 0.12)
}

// Theme-aware structural colors. `dark` comes from services/theme_service.darkEnabled().
export function chartColors(dark) {
  return dark
    ? {
        axis: '#b6b6b6',
        grid: 'rgba(255, 255, 255, 0.08)',
        label: '#c8c8c8',
        crosshair: '#8c8c8c',
        tooltipBg: '#292929',
        tooltipText: '#e6e6e6'
      }
    : {
        axis: '#2d2d2d',
        grid: 'rgba(0, 0, 0, 0.08)',
        label: '#3d3d3d',
        crosshair: '#999999',
        tooltipBg: '#ffffff',
        tooltipText: '#1d1d1d'
      }
}

export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Named series colors — MUST match the VISIBILITY checkmark colors in charts.scss.
// Secondary (y2) series use a LIGHTER blue in dark mode (#4dabf7, ~4.3:1 on the dark
// canvas) rather than #2970ff (~2.4:1) — the same low-contrast blue the primary series
// was moved off of. Kept blue (not a warm hue) so the green primary / blue secondary
// pairing stays colorblind-safe.
const SERIES_COLORS = {
  'tickets-price': { light: '#2970ff', dark: '#2dd8a3' },
  'tickets-bought': { light: '#006666', dark: '#4dabf7' },
  'hashrate-rate': { light: '#2970ff', dark: '#2dd8a3' },
  'hashrate-miners': { light: '#cc6600', dark: '#4dabf7' }
}
export function seriesColorByKey(key, dark) {
  const c = SERIES_COLORS[key]
  return c ? (dark ? c.dark : c.light) : null
}
export function fillForStroke(stroke, dark) {
  return hexToRgba(stroke, dark ? 0.18 : 0.12)
}
