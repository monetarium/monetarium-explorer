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
 * Tight, adaptive log-scale y-range. uPlot's built-in log range rounds out to whole
 * decades, which strands a near-constant series (e.g. ticket pool size in a zoomed
 * window) as a flat line floating in empty space. Instead we hug the visible data,
 * padding by just 5% of the visible log span so the data fills the plot. Guards keep
 * both bounds strictly positive (log needs > 0) and finite.
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
  const span = lHi - lLo
  const pad = span > 0 ? span * 0.05 : 0.02 // 0.02-decade fallback for a perfectly flat series
  return [Math.pow(10, lLo - pad), Math.pow(10, lHi + pad)]
}

/**
 * Evenly-spaced "nice" tick values (…1, 2, 5, 10…) covering [min, max]. Used for the
 * sub-decade log case, where 1/2/5×10ⁿ decade ticks fall outside the range entirely.
 * @param {number} min
 * @param {number} max
 * @param {number} target  approximate desired tick count
 * @returns {number[]}
 */
export function niceLinearTicks(min, max, target) {
  const span = max - min
  if (!(span > 0)) return [min]
  const rawStep = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const out = []
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    out.push(+v.toFixed(10)) // tame float accumulation (…00001)
  }
  return out
}

// uPlot axis `splits` for a log y-scale. Wide ranges (≥ 1 decade) get 1/2/5×10ⁿ
// decade ticks — thinned to powers of ten past 4 decades to avoid crowding. Narrow
// (sub-decade) ranges fall back to linear nice-ticks so the axis still has labels.
function logSplits(u, axisIdx, scaleMin, scaleMax) {
  if (!(scaleMin > 0) || !(scaleMax > scaleMin)) return niceLinearTicks(scaleMin, scaleMax, 6)
  const decades = Math.log10(scaleMax) - Math.log10(scaleMin)
  if (decades < 1) return niceLinearTicks(scaleMin, scaleMax, 8)
  const mantissas = decades <= 4 ? [1, 2, 5] : [1]
  const out = []
  for (let e = Math.floor(Math.log10(scaleMin)); e <= Math.ceil(Math.log10(scaleMax)); e++) {
    for (const m of mantissas) {
      const v = m * Math.pow(10, e)
      if (v >= scaleMin && v <= scaleMax) out.push(v)
    }
  }
  return out.length ? out : niceLinearTicks(scaleMin, scaleMax, 6)
}

// uPlot axis `values` for a log y-scale. Prefer compact k/M/B labels (threeSigFigs),
// but if that rounds adjacent ticks to the same string (very tight ranges, e.g.
// 5,118 vs 5,119 → "5.12k"), fall back to grouped full numbers at the step's precision.
function adaptiveLogValues(u, splits) {
  const sig = splits.map((v) => (v == null ? '' : humanize.threeSigFigs(v)))
  let collide = false
  for (let i = 1; i < sig.length; i++) {
    if (sig[i] && sig[i] === sig[i - 1]) {
      collide = true
      break
    }
  }
  if (!collide) return sig
  const finite = splits.filter((v) => v != null && isFinite(v))
  const step = finite.length >= 2 ? Math.abs(finite[1] - finite[0]) : 0
  const decimals = step >= 1 || step === 0 ? 0 : Math.min(8, Math.ceil(-Math.log10(step)))
  return splits.map((v) =>
    v == null
      ? ''
      : v.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        })
  )
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
    // Hug the data tightly instead of letting uPlot snap out to whole decades.
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
        side: scale === 'y2' ? 1 : 3 // 3 = left, 1 = right
      }
      if (isLog && scale === 'y') {
        // Adaptive ticks for the (tight) log y-scale — see logSplits / adaptiveLogValues.
        axis.splits = logSplits
        axis.values = adaptiveLogValues
      } else if (a.intTicks) {
        // Count axes (e.g. Active Miners) tick on integers only.
        axis.incrs = INT_INCRS
        axis.values = (u, splits) =>
          splits.map((v) => (v == null ? '' : Math.round(v).toLocaleString('en-US')))
      } else {
        axis.values = (u, splits) => splits.map((v) => (v == null ? '' : humanize.threeSigFigs(v)))
      }
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
 * @property {(min:number, max:number)=>void} setXRange  set the visible x-range
 * @property {()=>void} destroy        MUST be called on Stimulus disconnect
 */

/**
 * Build a live chart for `def` inside `el`.
 * @param {HTMLElement} el
 * @param {ChartDefinition} def
 * @param {{dark?:boolean, width?:number, height?:number,
 *          scaleType?:('linear'|'log'), syncKey?:string,
 *          onRangeChange?:(min:number, max:number)=>void}} [opts]
 *   onRangeChange fires only on user-driven x-range changes (drag-zoom, double-click
 *   reset) — never for programmatic setData/setXRange/rebuild.
 * @returns {Promise<ChartHandle>}
 */
export async function createChart(el, def, opts = {}) {
  const UPlot = await loadUPlot()
  let currentDef = def
  let xRange = null // { min, max } remembered to survive rebuilds
  let suppressRangeEvent = false // true while WE drive the x-scale (setData/setXRange/rebuild)
  const onRangeChange = typeof opts.onRangeChange === 'function' ? opts.onRangeChange : null

  // The adapter is the single owner of the x-range. This setScale hook records every
  // x-scale change — user drag-zoom, double-click reset, or our own programmatic
  // setScale — so the remembered range always reflects what's on screen and survives
  // rebuilds. Genuine user gestures also notify onRangeChange; our own scale changes
  // (setData autoscale, setXRange, the rebuild restore) raise suppressRangeEvent to stay
  // quiet, sparing the controller the load-time false positives a raw hook would emit.
  const trackXRange = (u, key) => {
    if (key !== 'x') return
    const sx = u.scales && u.scales.x
    if (!sx || sx.min == null || sx.max == null || !isFinite(sx.min) || !isFinite(sx.max)) return
    xRange = { min: sx.min, max: sx.max }
    if (!suppressRangeEvent && onRangeChange) onRangeChange(sx.min, sx.max)
  }
  const userHooks = opts.hooks || {}
  let state = {
    ...opts,
    hooks: { ...userHooks, setScale: [...(userHooks.setScale || []), trackXRange] }
  }

  let uplot = new UPlot(buildOpts(UPlot, currentDef, state), [[]], el)
  let destroyed = false
  // Last-known per-series visibility (series label -> show). A fresh uPlot defaults
  // every series to shown, so this is re-applied after each rebuild to keep a hidden
  // series hidden across mode/scale changes.
  const visibility = {}

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
    if (xRange) {
      suppressRangeEvent = true
      uplot.setScale('x', { min: xRange.min, max: xRange.max })
      suppressRangeEvent = false
    }
  }

  return {
    get uplot() {
      return uplot
    },
    setData(columns) {
      if (destroyed) return
      // setData autoscales and fires setScale; suppress so the load isn't mistaken
      // for a user zoom.
      suppressRangeEvent = true
      uplot.setData(columns)
      suppressRangeEvent = false
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
      suppressRangeEvent = true
      uplot.setScale('x', { min: min, max: max })
      suppressRangeEvent = false
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
