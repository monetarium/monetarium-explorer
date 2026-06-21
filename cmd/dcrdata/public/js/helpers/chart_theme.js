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

export const OTHERS_COLOR = '#adb5bd'

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length]
}

export function seriesStroke(i) {
  return colorForIndex(i)
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
const SERIES_COLORS = {
  'tickets-price': { light: '#2970ff', dark: '#2dd8a3' },
  'tickets-bought': { light: '#006666', dark: '#2970ff' },
  'hashrate-rate': { light: '#2970ff', dark: '#2dd8a3' },
  'hashrate-miners': { light: '#cc6600', dark: '#2970ff' }
}
export function seriesColorByKey(key, dark) {
  const c = SERIES_COLORS[key]
  return c ? (dark ? c.dark : c.light) : null
}
export function fillForStroke(stroke, dark) {
  return hexToRgba(stroke, dark ? 0.18 : 0.12)
}
