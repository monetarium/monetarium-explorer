// Overview "ranger" strip for /charts: a short uPlot of the full data extent with a
// drag-to-select rectangle plus two resize grips. Drives the main chart's x-range via an
// onSelect(min,max) callback and is repositioned by the controller via setSelection().
// Port of uPlot's zoom-ranger-grips demo (mouse events; desktop).

import { chartColors, fillForStroke } from './chart_theme'
import { resolveSeriesColor, loadUPlot } from './uplot_adapter'

/* global requestAnimationFrame */

export const BOUNDARY_LEFT = 0
export const BOUNDARY_RIGHT = 1
export const BOUNDARY_BOTH = 2

const RANGER_HEIGHT = 80
const RANGER_AXIS_FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

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
 * uPlot options for the overview strip. Pure (no DOM, no instance). The strip mirrors the
 * main chart's plot box: its x-axis is hidden (the main chart's x-axis sits directly above),
 * and its left/right y-axes reserve exactly the main chart's gutters via `size` getters. The
 * left y-axis also renders a single tick at the series average (suppressed when avg is null).
 * @param {{paths:object}} UPlot
 * @param {object} def  ChartDefinition (only series[0] + its color is used)
 * @param {{dark?:boolean, width?:number, height?:number, xTime?:boolean, hooks?:object,
 *          getLeftGutter?:()=>number, getRightGutter?:()=>number,
 *          getAvg?:()=>(number|null), getAvgLabel?:()=>string}} [opts]
 */
export function buildRangerOpts(UPlot, def, opts = {}) {
  const {
    dark = false,
    width = 800,
    height = RANGER_HEIGHT,
    xTime = true,
    hooks,
    getLeftGutter = () => 0,
    getRightGutter = () => 0,
    getAvg = () => null,
    getAvgLabel = () => ''
  } = opts
  const c = chartColors(dark)
  const primary = def.series[0]
  const stroke = resolveSeriesColor(primary, 0, dark)

  // Left y-axis: reserves the main chart's left gutter (via size) and shows one tick at the
  // series average. Right y-axis: reserves the main chart's right gutter (dual-axis charts)
  // with no visible content. Both are getter-driven so live updates need no rebuild.
  const leftAxis = {
    scale: 'y',
    side: 3,
    show: true,
    stroke: c.axis,
    grid: { show: false },
    ticks: { show: true, size: 3, stroke: c.axis },
    gap: 4,
    font: RANGER_AXIS_FONT,
    size: () => Math.max(0, Math.round(getLeftGutter())),
    splits: () => {
      const a = getAvg()
      return a == null ? [] : [a]
    },
    values: () => {
      const a = getAvg()
      return a == null ? [] : [getAvgLabel()]
    }
  }
  const rightAxis = {
    scale: 'y',
    side: 1,
    show: true,
    stroke: 'transparent',
    grid: { show: false },
    ticks: { show: false },
    size: () => Math.max(0, Math.round(getRightGutter())),
    splits: () => [],
    values: () => []
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
    axes: [{ show: false }, leftAxis, rightAxis], // x hidden; left avg tick; right reserve
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
  const curWidth = opts.width || 800
  const curHeight = opts.height || RANGER_HEIGHT
  // Mutable gutter/average state, read live by the axis getters below so updates need no
  // rebuild — setGutters/setAverage mutate these and trigger a relayout/redraw.
  let leftGutter = opts.leftGutter || 0
  let rightGutter = opts.rightGutter || 0
  let avgValue = opts.avgValue == null ? null : opts.avgValue
  let avgLabel = opts.avgLabel || ''
  let state = { ...opts }
  let destroyed = false

  // A fresh native drag-paint on the strip fires uPlot's setSelect hook (fire=true);
  // our own setSelection() passes fire=false, so it never reaches here.
  const onNativeSelect = (u) => {
    if (!onSelect) return
    const { left, width } = u.select
    onSelect(u.posToVal(left, 'x'), u.posToVal(left + width, 'x'))
  }
  const getters = {
    getLeftGutter: () => leftGutter,
    getRightGutter: () => rightGutter,
    getAvg: () => avgValue,
    getAvgLabel: () => avgLabel
  }
  const hooks = {
    ready: [(u) => installGrips(UPlot, u, onSelect)],
    setSelect: [onNativeSelect]
  }

  let uplot = new UPlot(buildRangerOpts(UPlot, def, { ...state, ...getters, hooks }), [[]], el)

  function rebuild() {
    const data = uplot.data
    uplot.destroy()
    uplot = new UPlot(buildRangerOpts(UPlot, def, { ...state, ...getters, hooks }), data, el)
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
    // Mirror the main chart's left/right plot insets onto the strip. The axis `size` getters
    // read these, so a relayout (setSize re-runs uPlot's axis-size convergence; redraw alone
    // would not) applies them. Epsilon-guarded to avoid a relayout on sub-pixel jitter.
    setGutters(left, right) {
      if (destroyed) return
      if (Math.abs(left - leftGutter) < 0.5 && Math.abs(right - rightGutter) < 0.5) return
      leftGutter = left
      rightGutter = right
      uplot.setSize({ width: curWidth, height: curHeight })
    },
    // Update the single average tick on the left y-axis (value=null suppresses it, e.g. SKA).
    setAverage(value, label) {
      if (destroyed) return
      avgValue = value == null ? null : value
      avgLabel = label || ''
      uplot.redraw(false, true)
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
