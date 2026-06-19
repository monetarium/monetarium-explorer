// Adapter between a ChartDefinition and a live uPlot chart. Keeps controllers free
// of the raw uPlot API. `buildOpts` is pure (no DOM, no instance) and is the unit
// under test; createChart (Task 5) wires it to a real uPlot.

import { chartColors, seriesStroke, seriesFill } from './chart_theme'

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
