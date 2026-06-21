// Overview "ranger" strip for /charts: a short uPlot of the full data extent with a
// drag-to-select rectangle plus two resize grips. Drives the main chart's x-range via an
// onSelect(min,max) callback and is repositioned by the controller via setSelection().
// Port of uPlot's zoom-ranger-grips demo (mouse events; desktop).

import { fillForStroke, hexToRgba } from './chart_theme'
import { resolveSeriesColor, loadUPlot } from './uplot_adapter'

/* global requestAnimationFrame */

export const BOUNDARY_LEFT = 0
export const BOUNDARY_RIGHT = 1
export const BOUNDARY_BOTH = 2

const RANGER_HEIGHT = 80
const RANGER_VPAD = 6 // top/bottom plot padding (px); left/right mirror the main chart's gutters

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
 * uPlot options for the overview strip. Pure (no DOM, no instance). The strip has no axes —
 * its x-axis would duplicate the main chart's (which sits directly above), and it carries no
 * y-axis. To still line up under the main chart, its left/right plot insets are reserved with
 * `padding` mirroring the main chart's measured gutters (getter-driven so updates need no
 * rebuild). The x-value domains differ when zoomed (the strip is always full-extent); only
 * the plot-area pixels are aligned.
 * @param {{paths:object}} UPlot
 * @param {object} def  ChartDefinition (only series[0] + its color is used)
 * @param {{dark?:boolean, width?:number, height?:number, xTime?:boolean, hooks?:object,
 *          getLeftGutter?:()=>number, getRightGutter?:()=>number}} [opts]
 */
export function buildRangerOpts(UPlot, def, opts = {}) {
  const {
    dark = false,
    width = 800,
    height = RANGER_HEIGHT,
    xTime = true,
    hooks,
    getLeftGutter = () => 0,
    getRightGutter = () => 0
  } = opts
  const primary = def.series[0]
  const stroke = resolveSeriesColor(primary, 0, dark)

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
    axes: [{ show: false }, { show: false }], // no x or y axis on the strip
    // [top, right, bottom, left] — left/right mirror the main chart's gutters so the plot
    // area lines up under it; top/bottom give the series a little breathing room.
    padding: [
      RANGER_VPAD,
      () => Math.max(0, Math.round(getRightGutter())),
      RANGER_VPAD,
      () => Math.max(0, Math.round(getLeftGutter()))
    ],
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

// Tint the selection rectangle + grips to match the strip's primary line color (`stroke`), so
// they recolor with the theme on rebuild. Hex-only — a non-hex stroke leaves the SCSS default
// (blue) in place. The fill keeps the SCSS opacities (0.14 body, 0.55 edges/grips).
function paintSelection(sel, gripL, gripR, stroke) {
  if (typeof stroke !== 'string' || stroke[0] !== '#') return
  const edge = hexToRgba(stroke, 0.55)
  sel.style.background = hexToRgba(stroke, 0.14)
  sel.style.borderLeftColor = edge
  sel.style.borderRightColor = edge
  gripL.style.background = edge
  gripR.style.background = edge
}

// Wire the drag handlers onto the freshly-built selection rectangle. The grip move
// repositions the rectangle itself (setSelect with fire=false, so it never echoes back to
// onSelect) and then calls onSelect(min,max) to drive the main chart. `stroke` tints the
// rectangle/grips to the strip's line color so they track the theme.
function installGrips(UPlot, u, onSelect, stroke) {
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
  const gripL = placeDiv(sel, 'u-grip-l')
  const gripR = placeDiv(sel, 'u-grip-r')
  gripL.addEventListener('mousedown', (e) => bind(e, BOUNDARY_LEFT))
  gripR.addEventListener('mousedown', (e) => bind(e, BOUNDARY_RIGHT))
  paintSelection(sel, gripL, gripR, stroke)
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
  // Mutable gutter state, read live by the padding getters below so updates need no rebuild —
  // setGutters mutates these and triggers a relayout.
  let leftGutter = opts.leftGutter ?? 0
  let rightGutter = opts.rightGutter ?? 0
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
    getRightGutter: () => rightGutter
  }
  // `state` is reassigned by setDark, and this closure reads it at hook-fire time, so a rebuild
  // re-tints the selection to the strip's current (theme-resolved) primary line color.
  const primary = def.series[0]
  const hooks = {
    ready: [(u) => installGrips(UPlot, u, onSelect, resolveSeriesColor(primary, 0, state.dark))],
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
    // Re-pixel the strip to a new container width (window resize). A pure width change does not
    // trip setGutters' epsilon guard, so the controller drives this explicitly; the caller
    // re-applies the selection afterward (it is pixel-based and invalid at the new width).
    setWidth(width) {
      if (destroyed) return
      if (!(width > 0) || Math.abs(width - uplot.width) < 0.5) return
      uplot.setSize({ width: width, height: uplot.height })
    },
    // Mirror the main chart's left/right plot insets onto the strip. The axis `size` getters
    // read these, so a relayout (setSize re-runs uPlot's axis-size convergence; redraw alone
    // would not) applies them. Epsilon-guarded to avoid a relayout on sub-pixel jitter.
    setGutters(left, right) {
      if (destroyed) return
      if (Math.abs(left - leftGutter) < 0.5 && Math.abs(right - rightGutter) < 0.5) return
      leftGutter = left
      rightGutter = right
      // setSize (not redraw) so uPlot re-runs its layout convergence and re-evaluates the
      // padding getters. Use the live dimensions so a future resize path can't be fought with
      // stale ones.
      uplot.setSize({ width: uplot.width, height: uplot.height })
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
