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

// Gap between the rotated y-axis title and its tick values. uPlot centers the label at
// the values' outer edge, so the default (0) leaves the 16px title touching wide ticks
// (e.g. "0.0035" on the Fees chart). A positive gap pushes the title clear.
const AXIS_LABEL_GAP = 8
// Width of the rotated y-axis title band. uPlot's default (30px) is sized for its 12px
// label; the 16px AXIS_LABEL_FONT plus AXIS_LABEL_GAP needs a wider band, else the
// gapped title clips at the canvas edge. Sized to hold the gap + label with margin.
const AXIS_LABEL_SIZE = 44

// Integer-only tick increments (1/2/5 × 10ⁿ) for count axes like "Active Miners",
// which must never show fractional ticks. Constrains uPlot's auto-stepper to integers.
const INT_INCRS = (() => {
  const incrs = []
  for (let e = 0; e <= 9; e++) for (const m of [1, 2, 5]) incrs.push(m * 10 ** e)
  return incrs
})()

// Time x-axis tick formats. Mirrors uPlot's built-in seconds-scale stamp matrix
// (the chart's x values are seconds — opts.ms defaults to 1e-3) but renders dates as
// "01 Jun" instead of uPlot's locale-ish default "6/1". Each row is
//   [minTickIncrSecs, default, year, month, day, hour, min, sec, mode]
// where columns 2-7 are "rollover" formats re-shown when that unit changes, and
// mode 1 concatenates the rollover onto the default. uPlot picks the first row whose
// threshold is <= the chosen tick increment (falling back to the last row), so the
// labels coarsen to "Jun" / "2024" when zoomed out and stay "01 Jun" up close.
// fmtDate tokens: {DD}=01 {MMM}=Jun {YYYY}=2024 {HH}=22 {mm}=05 {ss}=09.
// Times use 24-hour {HH}:{mm} ("22:00"), not uPlot's 12-hour default ("10pm").
const TIME_AXIS_VALUES = (() => {
  const s = 1
  const m = 60
  const h = 60 * m
  const d = 24 * h
  const y = 365 * d
  const _ = null
  const NLyyyy = '\n{YYYY}'
  const dmon = '{DD} {MMM}' // 01 Jun
  const NLdmon = `\n${dmon}`
  const NLdmonyy = `${NLdmon} {YYYY}` // \n01 Jun 2024
  const hmm = '{HH}:{mm}' // 22:00
  const NLhmm = `\n${hmm}`
  const ss = ':{ss}'
  return [
    //  incr     default       year       month  day                   hour  min       sec  mode
    [y, '{YYYY}', _, _, _, _, _, _, 1],
    [d * 28, '{MMM}', NLyyyy, _, _, _, _, _, 1],
    [d, dmon, NLyyyy, _, _, _, _, _, 1],
    [h, hmm, NLdmonyy, _, NLdmon, _, _, _, 1],
    [m, hmm, NLdmonyy, _, NLdmon, _, _, _, 1],
    [s, ss, `${NLdmonyy} ${hmm}`, _, `${NLdmon} ${hmm}`, _, NLhmm, _, 1]
  ]
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

export function resolveSeriesColor(s, i, dark) {
  if (s.color) return s.color
  if (s.colorKey) return seriesColorByKey(s.colorKey, dark) || seriesStroke(s.colorIndex ?? i, dark)
  return seriesStroke(s.colorIndex ?? i, dark)
}

/**
 * Tight, adaptive log-scale y-range. uPlot's built-in log range rounds out to whole
 * decades, which strands a near-constant series (e.g. ticket pool size in a zoomed
 * window) as a flat line floating in empty space. Instead we hug the visible data,
 * padding by just 5% of the visible log span so the data fills the plot. Guards keep
 * both bounds strictly positive (log needs > 0) and finite.
 *
 * When `floor` is a positive number AND the visible data reaches down to it, the lower
 * bound is pinned exactly to `floor` with no padding below — used by series that floor
 * sub-`floor` plot values up to it (SKA coin-supply, applyLogFloors). Pinning the axis
 * bottom to the same floor parks those floored points on the baseline (a zero-height
 * area) instead of floating them as a visible plateau above it. When every visible point
 * is above the floor (e.g. zoomed into the plateau), there is nothing to hide, so the
 * range hugs the data normally. The top always gets its usual headroom.
 * @param {number} dataMin
 * @param {number} dataMax
 * @param {number} [floor]  positive lower bound to pin the axis to when data reaches it
 * @returns {[number, number]}
 */
export function logRange(dataMin, dataMax, floor) {
  let lo = dataMin
  let hi = dataMax
  if (hi == null || !isFinite(hi) || hi <= 0) hi = lo != null && isFinite(lo) && lo > 0 ? lo : 10
  if (lo == null || !isFinite(lo) || lo <= 0) lo = hi / 10
  if (lo > hi) [lo, hi] = [hi, lo]
  // Pin only when the visible data actually reaches the floor (floored points sit at it).
  const pinned = floor != null && isFinite(floor) && floor > 0 && lo <= floor
  const lLo = Math.log10(pinned ? floor : lo)
  const lHi = Math.log10(hi)
  const span = lHi - lLo
  const pad = span > 0 ? span * 0.05 : 0.02 // 0.02-decade fallback for a perfectly flat series
  return [pinned ? floor : Math.pow(10, lLo - pad), Math.pow(10, lHi + pad)]
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

// Strip trailing fractional zeros (and a now-bare decimal point) from a formatted
// number so whole-value axis ticks read "75"/"1k" instead of threeSigFigs' sig-fig
// padding "75.0"/"1.00k". Lossless — "1.5k" still means 1500 — and suffix/grouping
// aware: "1.50k"->"1.5k", "5.11k"->"5.11k", "5,118"->"5,118".
export function trimTrailingZeros(s) {
  return s.replace(/(\.\d*?)0+(?=\D|$)/, '$1').replace(/\.(?=\D|$)/, '')
}

// Compact threeSigFigs label with filler zeros trimmed; '' for a null split.
function sigFigTick(v) {
  return v == null ? '' : trimTrailingZeros(humanize.threeSigFigs(v))
}

// uPlot axis `values` for a log y-scale. Prefer compact k/M/B labels (threeSigFigs),
// but if that rounds adjacent ticks to the same string (very tight ranges, e.g.
// 5,118 vs 5,119 → "5.12k"), fall back to grouped full numbers at the step's precision.
function adaptiveLogValues(u, splits) {
  const sig = splits.map(sigFigTick)
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
    // Hug the data tightly instead of letting uPlot snap out to whole decades. If a
    // series declares a logFloor (e.g. SKA coin-supply floors leading zeros at 1 whole
    // coin), pin the axis bottom to the smallest such floor so the floored values rest
    // on the baseline rather than floating as a visible plateau above it.
    const floor = def.series.reduce(
      (m, s) => (s && s.logFloor != null ? (m == null ? s.logFloor : Math.min(m, s.logFloor)) : m),
      null
    )
    scales.y.range = (u, dataMin, dataMax) => logRange(dataMin, dataMax, floor)
  } else if (def.yMin != null) {
    const yMin = def.yMin
    scales.y.range = (u, dataMin, dataMax) => [yMin, dataMax]
  }
  // y2 stays linear even when y is log — it is typically a secondary count axis; revisit if a log y2 is ever needed.
  if (def.axes.some((a) => (a.scale || 'y') === 'y2')) {
    scales.y2 = { distr: LINEAR_DISTR }
  }

  const xAxis = { stroke: c.axis, grid: { stroke: c.grid }, ticks: { stroke: c.grid } }
  xAxis.values = xTime
    ? TIME_AXIS_VALUES // date stamps -> "01 Jun" instead of uPlot's default "6/1"
    : (u, splits) => splits.map(sigFigTick)

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
        labelSize: AXIS_LABEL_SIZE,
        labelGap: AXIS_LABEL_GAP,
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
        axis.values = (u, splits) => splits.map(sigFigTick)
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

  let bands
  if (def.stacked) {
    const visibility = opts.visibility || {}
    const omit = (i) => visibility[def.series[i - 1].label] === false
    // stack() only needs the shape to derive bands; feed a 1-row stub so the band
    // computation runs without the real data (data is stacked separately in the handle).
    const stub = [[0], ...def.series.map(() => [0])]
    bands = stack(stub, omit).bands
  }

  const out = {
    width: width,
    height: height,
    scales: scales,
    axes: axes,
    series: series,
    bands: bands,
    cursor: cursor,
    legend: { show: false }
  }
  if (hooks) out.hooks = hooks
  return out
}

let uPlotCtor // memoized after first dynamic import

export async function loadUPlot() {
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
 * @property {(dark:boolean)=>void} setDark   recolor for a theme switch (rebuilds)
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
/**
 * uPlot stacking transform (port of uPlot's demos/stack.js). Accumulates each
 * non-omitted series into a running per-row total and emits `bands` so uPlot fills
 * each visible series down to the next visible one above it — the canonical way to
 * render stacked area/bar charts. Pure; never mutates the input.
 *
 * Null/NaN y-values count as 0 in the running total but stay null in their own
 * column (rendered as a gap). `omit(i)` (1-based series index) excludes a hidden
 * series from both accumulation and bands, so a visibility toggle restacks exactly.
 * @param {Array<Array<number|null>>} columns  [xs, ...ys]
 * @param {(seriesIdx1Based:number)=>boolean} omit
 * @returns {{ data: Array<Array<number|null>>, bands: Array<{series:[number,number]}> }}
 */
export function stack(columns, omit) {
  const xs = columns[0]
  const len = xs.length
  const accum = new Array(len).fill(0)
  const data = [xs]
  for (let i = 1; i < columns.length; i++) {
    const col = columns[i]
    if (omit(i)) {
      data.push(col) // hidden: passed through, not drawn, not accumulated
      continue
    }
    data.push(
      col.map((v, r) => {
        if (v == null || !isFinite(v)) return v // keep the gap in this column
        accum[r] += v
        return accum[r]
      })
    )
  }
  const bands = []
  for (let i = 1; i < columns.length; i++) {
    if (omit(i)) continue
    let above = -1
    for (let j = i + 1; j < columns.length; j++) {
      if (!omit(j)) {
        above = j
        break
      }
    }
    if (above > -1) bands.push({ series: [above, i] })
  }
  return { data, bands }
}

/**
 * On a log scale, raise each series' sub-`logFloor` plot values up to its floor so the
 * line stays plottable (log10(0) = -Inf) and the log axis does not collapse onto the
 * floor (the SKA coin-supply zeros-then-plateau case). Off log, or when no series
 * declares a floor, the columns are returned unchanged (same reference). Null is
 * preserved (a geometry-nulled point stays a gap). Never mutates the input — the exact
 * value still reaches the tooltip via the raw payload.
 * @param {Array<Array<number|null>>} columns  [xs, ...ys] (columns[i] -> series[i-1])
 * @param {Array<{logFloor?:number}>} series
 * @param {boolean} isLog
 */
export function applyLogFloors(columns, series, isLog) {
  if (!isLog || !columns || !series.some((s) => s && s.logFloor != null)) return columns
  return columns.map((col, i) => {
    if (i === 0) return col // x column
    const floor = series[i - 1] && series[i - 1].logFloor
    if (floor == null) return col
    return col.map((v) => (v != null && v < floor ? floor : v))
  })
}

export async function createChart(el, def, opts = {}) {
  const UPlot = await loadUPlot()
  let currentDef = def
  // Last raw [xs, ...ys] from setData. The plotted data is re-derived from it on every
  // (re)build, so a series logFloor follows the CURRENT scale across a linear<->log toggle
  // (a toggle reuses stored data without re-running the definition's toColumns).
  let rawColumns = null
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

  // uPlot fires the setScale hook on a microtask (commit -> queueMicrotask), so the
  // suppress flag can't be cleared synchronously — it would be down before the hook
  // runs. Run our scale change with the flag up, then clear it on a microtask queued
  // AFTER uPlot's commit one; FIFO ordering means the hook still sees it set. A genuine
  // user gesture is never wrapped this way, so its hook fires with the flag clear.
  const withProgrammaticScale = (fn) => {
    suppressRangeEvent = true
    fn()
    queueMicrotask(() => {
      suppressRangeEvent = false
    })
  }
  const userHooks = opts.hooks || {}
  // Last-known per-series visibility (series label -> show). A fresh uPlot defaults
  // every series to shown, so this is re-applied after each rebuild to keep a hidden
  // series hidden across mode/scale changes. Seeded from opts so buildOpts bands and
  // the initial displayData() agree with the caller's starting visibility.
  const visibility = {}
  if (opts.visibility) Object.assign(visibility, opts.visibility)
  // Merge the adapter's internal setScale hook (trackXRange) into any caller-provided
  // hooks. This computed hooks object is also what gets spread into state below so that
  // buildOpts (called on every rebuild) receives the merged hook set.
  const hooks = { ...userHooks, setScale: [...(userHooks.setScale || []), trackXRange] }
  let state = {
    ...opts,
    visibility, // buildOpts reads this for stacked bands
    hooks // overrides opts.hooks with the merged set; shorthand matches visibility above
  }

  // Plotted data for the current scale/stacking, derived from the raw columns.
  const displayData = () => {
    if (!rawColumns) return uplot.data
    if (currentDef.stacked) {
      const omit = (i) => visibility[currentDef.series[i - 1].label] === false
      return stack(rawColumns, omit).data
    }
    return applyLogFloors(rawColumns, currentDef.series, state.scaleType === 'log')
  }

  let uplot = new UPlot(buildOpts(UPlot, currentDef, state), [[]], el)
  let destroyed = false

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
    // Re-derive from the raw columns so a scale change re-applies (or drops) the log floor;
    // fall back to uplot.data if rebuilt before the first setData (the [[]] seed).
    const data = rawColumns ? displayData() : uplot.data
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
      withProgrammaticScale(() => uplot.setScale('x', { min: xRange.min, max: xRange.max }))
    }
  }

  return {
    get uplot() {
      return uplot
    },
    setData(columns) {
      if (destroyed) return
      rawColumns = columns
      // setData autoscales and fires setScale; suppress so the load isn't mistaken
      // for a user zoom.
      withProgrammaticScale(() => uplot.setData(displayData()))
    },
    setScaleType(type) {
      if (destroyed) return
      if ((state.scaleType || 'linear') === type) return // already there — skip the rebuild
      state = { ...state, scaleType: type }
      rebuild()
    },
    // uPlot bakes the theme colors (axis/grid/labels, series strokes/fills) into the opts
    // at construction, so a light<->dark switch needs a rebuild — there is no live recolor.
    // rebuild() preserves the data, visibility, and x-range, so the current zoom survives.
    setDark(dark) {
      if (destroyed) return
      if (!!state.dark === !!dark) return // already there — skip the rebuild
      state = { ...state, dark: dark }
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
      Object.keys(map).forEach((label) => {
        visibility[label] = !!map[label]
      })
      if (currentDef.stacked) {
        // Restack: bands + accumulation must recompute for the new visible set, which
        // is baked into opts at construction — so rebuild, then re-apply hidden flags
        // and re-feed the restacked data.
        rebuild()
        if (rawColumns) withProgrammaticScale(() => uplot.setData(displayData()))
        return
      }
      currentDef.series.forEach((s, i) => {
        if (Object.prototype.hasOwnProperty.call(map, s.label)) {
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
      withProgrammaticScale(() => uplot.setScale('x', { min: min, max: max }))
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
