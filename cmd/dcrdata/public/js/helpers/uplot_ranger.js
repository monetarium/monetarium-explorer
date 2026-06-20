// Overview "ranger" strip for /charts: a short uPlot of the full data extent with a
// drag-to-select rectangle plus two resize grips. Drives the main chart's x-range via an
// onSelect(min,max) callback and is repositioned by the controller via setSelection().
// Port of uPlot's zoom-ranger-grips demo (mouse events; desktop).

import { chartColors, fillForStroke } from './chart_theme'
import { resolveSeriesColor, loadUPlot } from './uplot_adapter'
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

function debounce(fn) {
  let raf = null
  return (...args) => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      fn(...args)
      raf = null
    })
  }
}

function placeDiv(parent, cls) {
  const el = document.createElement('div')
  el.classList.add(cls)
  parent.appendChild(el)
  return el
}

// Wire the drag handlers onto the freshly-built selection rectangle. The grip move
// repositions the rectangle itself (setSelect with fire=false, so it never echoes back to
// onSelect) and then calls onSelect(min,max) to drive the main chart.
function installGrips(UPlot, u, onSelect) {
  const sel = u.root.querySelector('.u-select')
  if (!sel) return
  const pxRatio = UPlot.pxRatio || 1
  let x0 = 0
  let lft0 = 0
  let rgt0 = 0

  const moveFor = (boundary) =>
    debounce((e) => {
      const dx = e.clientX - x0
      const maxRgt = u.bbox.width / pxRatio
      let nl = lft0
      let nr = rgt0
      if (boundary === BOUNDARY_BOTH) {
        nl = lft0 + dx
        nr = rgt0 + dx
      } else if (boundary === BOUNDARY_LEFT) {
        nl = lft0 + dx
      } else {
        nr = rgt0 + dx
      }
      const { left, width } = clampBoundary(nl, nr, boundary, maxRgt)
      const height = u.bbox.height / pxRatio
      u.setSelect({ left: left, top: 0, width: width, height: height }, false)
      if (onSelect) onSelect(u.posToVal(left, 'x'), u.posToVal(left + width, 'x'))
    })

  const bind = (e, boundary) => {
    x0 = e.clientX
    lft0 = u.select.left
    rgt0 = lft0 + u.select.width
    const onMove = moveFor(boundary)
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.stopPropagation() // keep uPlot's own drag-select from also firing
  }

  sel.addEventListener('mousedown', (e) => bind(e, BOUNDARY_BOTH))
  placeDiv(sel, 'u-grip-l').addEventListener('mousedown', (e) => bind(e, BOUNDARY_LEFT))
  placeDiv(sel, 'u-grip-r').addEventListener('mousedown', (e) => bind(e, BOUNDARY_RIGHT))
}

/**
 * Build a live overview strip for `def` inside `el`.
 * @param {HTMLElement} el
 * @param {object} def  ChartDefinition
 * @param {{dark?:boolean, width?:number, height?:number, xTime?:boolean,
 *          onSelect?:(min:number, max:number)=>void}} [opts]
 * @returns {Promise<{uplot:object, setData:Function, setSelection:Function,
 *                    setDark:Function, destroy:Function}>}
 */
export async function createRanger(el, def, opts = {}) {
  const UPlot = await loadUPlot()
  const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null
  let state = { ...opts }
  let destroyed = false

  // A fresh native drag-paint on the strip fires uPlot's setSelect hook (fire=true);
  // our own setSelection() passes fire=false, so it never reaches here.
  const onNativeSelect = (u) => {
    if (!onSelect) return
    const { left, width } = u.select
    onSelect(u.posToVal(left, 'x'), u.posToVal(left + width, 'x'))
  }
  const hooks = {
    ready: [(u) => installGrips(UPlot, u, onSelect)],
    setSelect: [onNativeSelect]
  }

  let uplot = new UPlot(buildRangerOpts(UPlot, def, { ...state, hooks }), [[]], el)

  function rebuild() {
    const data = uplot.data
    uplot.destroy()
    uplot = new UPlot(buildRangerOpts(UPlot, def, { ...state, hooks }), data, el)
  }

  return {
    get uplot() {
      return uplot
    },
    setData(cols) {
      if (destroyed) return
      uplot.setData(cols)
    },
    setSelection(min, max) {
      if (destroyed) return
      if (min == null || max == null || !isFinite(min) || !isFinite(max)) return
      const left = Math.round(uplot.valToPos(min, 'x'))
      const right = Math.round(uplot.valToPos(max, 'x'))
      const height = uplot.bbox.height / (UPlot.pxRatio || 1)
      uplot.setSelect({ left: left, top: 0, width: right - left, height: height }, false)
    },
    setDark(dark) {
      if (destroyed) return
      state = { ...state, dark: dark }
      rebuild()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      uplot.destroy()
    }
  }
}
