// Overview "ranger" strip for /charts: a short uPlot of the full data extent with a
// drag-to-select rectangle plus two resize grips. Drives the main chart's x-range via an
// onSelect(min,max) callback and is repositioned by the controller via setSelection().
// Port of uPlot's zoom-ranger-grips demo (mouse events; desktop).

import { chartColors, fillForStroke } from './chart_theme'
import { resolveSeriesColor } from './uplot_adapter'
import humanize from './humanize_helper'

export const BOUNDARY_LEFT = 0
export const BOUNDARY_RIGHT = 1
export const BOUNDARY_BOTH = 2

const RANGER_HEIGHT = 80

/**
 * Clamp a dragged selection [newLft,newRgt] (CSS px) against the plot width. Pure.
 * BOTH preserves the window width and slides it inside [0,maxRgt]; LEFT/RIGHT clamp the
 * moved edge to [0,maxRgt] and prevent it from crossing the fixed edge.
 * @returns {{left:number, width:number}}
 */
export function clampBoundary(newLft, newRgt, boundary, maxRgt) {
  if (boundary === BOUNDARY_BOTH) {
    const initWidth = newRgt - newLft
    if (newRgt > maxRgt) {
      newRgt = maxRgt
      newLft = newRgt - initWidth
    } else if (newLft < 0) {
      newLft = 0
      newRgt = newLft + initWidth
    }
  } else {
    if (newLft > newRgt) {
      if (boundary === BOUNDARY_LEFT) newLft = newRgt
      else newRgt = newLft
    }
    newLft = Math.max(0, newLft)
    newRgt = Math.min(newRgt, maxRgt)
  }
  return { left: newLft, width: newRgt - newLft }
}

/**
 * uPlot options for the overview strip. Pure (no DOM, no instance).
 * @param {{paths:object}} UPlot
 * @param {object} def  ChartDefinition (only series[0] + its color is used)
 * @param {{dark?:boolean, width?:number, height?:number, xTime?:boolean, hooks?:object}} [opts]
 */
export function buildRangerOpts(UPlot, def, opts = {}) {
  const { dark = false, width = 800, height = RANGER_HEIGHT, xTime = true, hooks } = opts
  const c = chartColors(dark)
  const primary = def.series[0]
  const stroke = resolveSeriesColor(primary, 0, dark)

  const xAxis = { stroke: c.axis, grid: { stroke: c.grid }, ticks: { stroke: c.grid } }
  if (!xTime) {
    xAxis.values = (u, splits) => splits.map((v) => (v == null ? '' : humanize.threeSigFigs(v)))
  }

  const out = {
    width: width,
    height: height,
    cursor: {
      x: false,
      y: false,
      points: { show: false },
      drag: { setScale: false, setSelect: true, x: true, y: false }
    },
    legend: { show: false },
    scales: { x: { time: xTime } },
    axes: [xAxis, { show: false }], // x shown for orientation; y hidden
    series: [
      {},
      {
        label: primary.label,
        stroke: stroke,
        fill: fillForStroke(stroke, dark),
        paths: UPlot.paths.linear(),
        points: { show: false }
      }
    ]
  }
  if (hooks) out.hooks = hooks
  return out
}
