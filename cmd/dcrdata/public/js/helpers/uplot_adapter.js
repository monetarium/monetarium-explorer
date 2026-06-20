// Adapter between a ChartDefinition and a live uPlot chart. Keeps controllers free
// of the raw uPlot API. `buildOpts` is pure (no DOM, no instance) and is the unit
// under test; createChart (Task 5) wires it to a real uPlot.

import { chartColors, seriesStroke, seriesColorByKey, fillForStroke } from './chart_theme'
import { getDefault } from './module_helper'
import humanize from './humanize_helper'

const LINEAR_DISTR = 1
const LOG_DISTR = 3 // uPlot scale.distr: 1 = linear, 3 = log

// Axis title font. uPlot draws axis labels on canvas at 12px by default — too small
// next to the data — so titles are bumped to 16px for legibility.
const AXIS_LABEL_FONT = '600 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// Integer-only tick increments (1/2/5 × 10ⁿ) for count axes like "Active Miners",
// which must never show fractional ticks. Constrains uPlot's auto-stepper to integers.
const INT_INCRS = (() => {
  const incrs = []
  for (let e = 0; e <= 9; e++) for (const m of [1, 2, 5]) incrs.push(m * 10 ** e)
  return incrs
})()

/**
 * @typedef {Object} AxisSpec
 * @property {string} label
 * @property {('y'|'y2')} [scale]  // defaults to 'y'
 * @property {boolean} [intTicks]  // restrict ticks to integers (count axes)
 *
 * @typedef {Object} SeriesSpec
 * @property {string} label
 * @property {('y'|'y2')} [scale]  // defaults to 'y'
 * @property {('line'|'stepped'|'area'|'bars')} kind
 * @property {number} [colorIndex]  // defaults to the series' position
 * @property {string} [color]       // explicit stroke, bypasses the palette
 * @property {string} [colorKey]    // named theme color (chart_theme.seriesColorByKey)
 * @property {number[]} [dash]      // dashed-line pattern
 * @property {number} [width]       // stroke width in px (uPlot default is 1)
 * @property {boolean} [spanGaps]   // draw the line across null gaps
 *
 * @typedef {Object} ChartDefinition
 * @property {string} name
 * @property {string} label
 * @property {{bin:boolean, scale:boolean, mode:boolean, zoom:boolean,
 *            visibility:(string[]|null), interval:boolean}} [controls]
 * @property {AxisSpec[]} axes
 * @property {SeriesSpec[]} series
 * @property {(settings:object)=>string} [url]
 * @property {(raw:object, settings:object)=>number[][]} [toColumns]
 * @property {(seriesIdx:number, rawDatum:*, settings:object)=>string} [formatValue]
 */

function pathsFor(UPlot, kind) {
  switch (kind) {
    case 'bars':
      return UPlot.paths.bars({ size: [0.6, 100], align: 0 })
    case 'stepped':
      return UPlot.paths.stepped({ align: 1 })
    default: // 'line' and 'area' share the linear path; 'area' adds a fill
      return UPlot.paths.linear()
  }
}

function resolveSeriesColor(s, i, dark) {
  if (s.color) return s.color
  if (s.colorKey) return seriesColorByKey(s.colorKey, dark) || seriesStroke(s.colorIndex ?? i)
  return seriesStroke(s.colorIndex ?? i)
}

/**
 * Log-scale y-range that centers the visible data. uPlot's built-in log range rounds
 * out to whole decades, which pins a near-constant series (e.g. ticket pool size in a
 * zoomed window) to the top or bottom edge. Instead we pad symmetrically in log10
 * space — 10% of the visible span, with a 0.15-decade floor so a flat series still
 * lands mid-plot. Guards keep both bounds strictly positive (log needs > 0) and finite.
 * @param {number} dataMin
 * @param {number} dataMax
 * @returns {[number, number]}
 */
export function logRange(dataMin, dataMax) {
  let lo = dataMin
  let hi = dataMax
  if (hi == null || !isFinite(hi) || hi <= 0) hi = lo != null && isFinite(lo) && lo > 0 ? lo : 10
  if (lo == null || !isFinite(lo) || lo <= 0) lo = hi / 10
  if (lo > hi) [lo, hi] = [hi, lo]
  const lLo = Math.log10(lo)
  const lHi = Math.log10(hi)
  const pad = Math.max((lHi - lLo) * 0.1, 0.15)
  return [Math.pow(10, lLo - pad), Math.pow(10, lHi + pad)]
}

/**
 * Translate a ChartDefinition into a uPlot options object. Pure.
 * @param {Function|{paths:object}} UPlot  uPlot constructor (for static `.paths`)
 * @param {ChartDefinition} def
 * @param {{dark?:boolean, width?:number, height?:number,
 *          scaleType?:('linear'|'log'), syncKey?:string}} [opts]
 * @returns {object} uPlot opts
 */
export function buildOpts(UPlot, def, opts = {}) {
  const {
    dark = false,
    width = 800,
    height = 400,
    scaleType = 'linear',
    syncKey,
    xTime = true,
    hooks
  } = opts
  const c = chartColors(dark)
  const seriesColors = def.series.map((s, i) => resolveSeriesColor(s, i, dark))

  const isLog = scaleType === 'log'
  const scales = { x: { time: xTime } }
  scales.y = { distr: isLog ? LOG_DISTR : LINEAR_DISTR }
  if (isLog) {
    // Center near-constant data instead of letting uPlot snap to whole decades.
    scales.y.range = (u, dataMin, dataMax) => logRange(dataMin, dataMax)
  } else if (def.yMin != null) {
    const yMin = def.yMin
    scales.y.range = (u, dataMin, dataMax) => [yMin, dataMax]
  }
  // y2 stays linear even when y is log — it is typically a secondary count axis; revisit if a log y2 is ever needed.
  if (def.axes.some((a) => (a.scale || 'y') === 'y2')) {
    scales.y2 = { distr: LINEAR_DISTR }
  }

  const xAxis = { stroke: c.axis, grid: { stroke: c.grid }, ticks: { stroke: c.grid } }
  if (!xTime) {
    xAxis.values = (u, splits) => splits.map((v) => (v == null ? '' : humanize.threeSigFigs(v)))
  }

  const axes = [
    xAxis,
    ...def.axes.map((a) => {
      const scale = a.scale || 'y'
      const si = def.series.findIndex((s) => (s.scale || 'y') === scale && !s.color)
      const axisColor = si >= 0 ? seriesColors[si] : c.axis
      const axis = {
        scale: scale,
        label: a.label,
        labelFont: AXIS_LABEL_FONT,
        stroke: axisColor,
        grid: { stroke: scale === 'y' ? c.grid : 'transparent' },
        side: scale === 'y2' ? 1 : 3, // 3 = left, 1 = right
        values: a.intTicks
          ? (u, splits) =>
              splits.map((v) => (v == null ? '' : Math.round(v).toLocaleString('en-US')))
          : (u, splits) => splits.map((v) => (v == null ? '' : humanize.threeSigFigs(v)))
      }
      // Count axes (e.g. Active Miners) tick on integers only.
      if (a.intTicks) axis.incrs = INT_INCRS
      return axis
    })
  ]

  const series = [
    {},
    ...def.series.map((s, i) => {
      const filled = s.kind === 'area' || s.kind === 'bars'
      const entry = {
        label: s.label,
        scale: s.scale || 'y',
        stroke: seriesColors[i],
        fill: filled ? fillForStroke(seriesColors[i], dark) : null,
        paths: pathsFor(UPlot, s.kind),
        points: { show: false },
        spanGaps: !!s.spanGaps
      }
      if (s.dash) entry.dash = s.dash
      if (s.width != null) entry.width = s.width
      return entry
    })
  ]

  const cursor = {}
  if (syncKey) cursor.sync = { key: syncKey, setSeries: true }

  const out = {
    width: width,
    height: height,
    scales: scales,
    axes: axes,
    series: series,
    cursor: cursor,
    legend: { show: false }
  }
  if (hooks) out.hooks = hooks
  return out
}

let uPlotCtor // memoized after first dynamic import

async function loadUPlot() {
  if (!uPlotCtor) {
    uPlotCtor = await getDefault(import(/* webpackChunkName: "uplot" */ 'uplot'))
  }
  return uPlotCtor
}

/**
 * @typedef {Object} ChartHandle
 * @property {object} uplot              live uPlot instance (escape hatch)
 * @property {(columns:number[][])=>void} setData
 * @property {(type:('linear'|'log'))=>void} setScaleType
 * @property {(mode:('line'|'stepped'))=>void} setMode
 * @property {(map:Object<string,boolean>)=>void} setVisibility
 * @property {(width:number, height:number)=>void} resize
 * @property {()=>void} destroy        MUST be called on Stimulus disconnect
 */

/**
 * Build a live chart for `def` inside `el`.
 * @param {HTMLElement} el
 * @param {ChartDefinition} def
 * @param {{dark?:boolean, width?:number, height?:number,
 *          scaleType?:('linear'|'log'), syncKey?:string}} [opts]
 * @returns {Promise<ChartHandle>}
 */
export async function createChart(el, def, opts = {}) {
  const UPlot = await loadUPlot()
  let currentDef = def
  let state = { ...opts }
  let uplot = new UPlot(buildOpts(UPlot, currentDef, state), [[]], el)
  let destroyed = false
  // Last-known per-series visibility (series label -> show). A fresh uPlot defaults
  // every series to shown, so this is re-applied after each rebuild to keep a hidden
  // series hidden across mode/scale changes.
  const visibility = {}
  let xRange = null // { min, max } remembered to survive rebuilds

  function applyVisibility() {
    currentDef.series.forEach((s, i) => {
      if (Object.prototype.hasOwnProperty.call(visibility, s.label)) {
        uplot.setSeries(i + 1, { show: visibility[s.label] })
      }
    })
  }

  // uPlot fixes a series' paths and a scale's distribution at construction, so a
  // mode (line<->stepped) or scale (linear<->log) change rebuilds. Data carries over
  // via uplot.data (the initial [[]] seed persists if rebuilt before the first
  // setData), and visibility is re-applied since the fresh instance starts all-shown.
  function rebuild() {
    const data = uplot.data
    uplot.destroy()
    // The old instance is already destroyed here, so it cannot be restored if
    // construction fails. Mark the handle inert (the destroyed-guard makes later
    // calls no-op) and rethrow, rather than leave it pointing at a dead instance.
    try {
      uplot = new UPlot(buildOpts(UPlot, currentDef, state), data, el)
    } catch (e) {
      destroyed = true
      throw e
    }
    applyVisibility()
    if (xRange) uplot.setScale('x', { min: xRange.min, max: xRange.max })
  }

  return {
    get uplot() {
      return uplot
    },
    setData(columns) {
      if (destroyed) return
      uplot.setData(columns)
    },
    setScaleType(type) {
      if (destroyed) return
      if ((state.scaleType || 'linear') === type) return // already there — skip the rebuild
      state = { ...state, scaleType: type }
      rebuild()
    },
    setMode(mode) {
      if (destroyed) return
      // Skip the rebuild when no line/stepped series would change kind — the
      // requested mode is already in effect, so a rebuild would be pure churn.
      const unchanged = currentDef.series.every(
        (s) => (s.kind !== 'line' && s.kind !== 'stepped') || s.kind === mode
      )
      if (unchanged) return
      currentDef = {
        ...currentDef,
        series: currentDef.series.map((s) =>
          s.kind === 'line' || s.kind === 'stepped' ? { ...s, kind: mode } : s
        )
      }
      rebuild()
    },
    setVisibility(map) {
      if (destroyed) return
      currentDef.series.forEach((s, i) => {
        if (Object.prototype.hasOwnProperty.call(map, s.label)) {
          visibility[s.label] = !!map[s.label]
          uplot.setSeries(i + 1, { show: visibility[s.label] })
        }
      })
    },
    resize(width, height) {
      if (destroyed) return
      state = { ...state, width: width, height: height }
      uplot.setSize({ width, height })
    },
    setXRange(min, max) {
      if (destroyed) return
      xRange = { min: min, max: max }
      uplot.setScale('x', { min: min, max: max })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      uplot.destroy()
    }
  }
}

// Shared key for uPlot cursor.sync — pass into createChart({ syncKey }) so a group
// of charts mirror cursor/zoom (consumed by PR 3, the proposal page).
export function createSyncKey(name) {
  return `mon-chart-sync:${name}`
}
