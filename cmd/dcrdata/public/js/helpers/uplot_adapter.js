// Adapter between a ChartDefinition and a live uPlot chart. Keeps controllers free
// of the raw uPlot API. `buildOpts` is pure (no DOM, no instance) and is the unit
// under test; createChart (Task 5) wires it to a real uPlot.

import { chartColors, seriesStroke, seriesFill } from './chart_theme'
import { getDefault } from './module_helper'

const LINEAR_DISTR = 1
const LOG_DISTR = 3 // uPlot scale.distr: 1 = linear, 3 = log

/**
 * @typedef {Object} AxisSpec
 * @property {string} label
 * @property {('y'|'y2')} [scale]  // defaults to 'y'
 *
 * @typedef {Object} SeriesSpec
 * @property {string} label
 * @property {('y'|'y2')} [scale]  // defaults to 'y'
 * @property {('line'|'stepped'|'area'|'bars')} kind
 * @property {number} [colorIndex]  // defaults to the series' position
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

/**
 * Translate a ChartDefinition into a uPlot options object. Pure.
 * @param {Function|{paths:object}} UPlot  uPlot constructor (for static `.paths`)
 * @param {ChartDefinition} def
 * @param {{dark?:boolean, width?:number, height?:number,
 *          scaleType?:('linear'|'log'), syncKey?:string}} [opts]
 * @returns {object} uPlot opts
 */
export function buildOpts(UPlot, def, opts = {}) {
  const { dark = false, width = 800, height = 400, scaleType = 'linear', syncKey } = opts
  const c = chartColors(dark)

  const scales = { x: { time: true } }
  scales.y = { distr: scaleType === 'log' ? LOG_DISTR : LINEAR_DISTR }
  // y2 stays linear even when y is log — it is typically a secondary count axis; revisit if a log y2 is ever needed.
  if (def.axes.some((a) => (a.scale || 'y') === 'y2')) {
    scales.y2 = { distr: LINEAR_DISTR }
  }

  const axes = [
    { stroke: c.axis, grid: { stroke: c.grid }, ticks: { stroke: c.grid } },
    ...def.axes.map((a) => {
      const scale = a.scale || 'y'
      return {
        scale: scale,
        label: a.label,
        stroke: c.axis,
        grid: { stroke: scale === 'y' ? c.grid : 'transparent' },
        side: scale === 'y2' ? 1 : 3 // 3 = left, 1 = right
      }
    })
  ]

  const series = [
    {},
    ...def.series.map((s, i) => {
      const idx = s.colorIndex ?? i
      const filled = s.kind === 'area' || s.kind === 'bars'
      return {
        label: s.label,
        scale: s.scale || 'y',
        stroke: seriesStroke(idx),
        fill: filled ? seriesFill(idx, dark) : null,
        paths: pathsFor(UPlot, s.kind),
        points: { show: false }
      }
    })
  ]

  const cursor = {}
  if (syncKey) cursor.sync = { key: syncKey, setSeries: true }

  return {
    width: width,
    height: height,
    scales: scales,
    axes: axes,
    series: series,
    cursor: cursor,
    legend: { show: false }
  }
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
    uplot = new UPlot(buildOpts(UPlot, currentDef, state), data, el)
    applyVisibility()
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
      state = { ...state, scaleType: type }
      rebuild()
    },
    setMode(mode) {
      if (destroyed) return
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
