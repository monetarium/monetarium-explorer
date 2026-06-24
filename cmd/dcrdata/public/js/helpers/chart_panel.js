// A reusable uPlot chart panel: owns one chart's full lifecycle (chart handle + tooltip +
// optional ranger + theme + resize) so page controllers stop hand-rolling it. Composition,
// not a Stimulus base — a controller creates one panel per chart. See
// docs/superpowers/specs/2026-06-24-reusable-chart-panel-design.md.

import { darkEnabled } from '../services/theme_service'
import { createChart } from './uplot_adapter'

export function createChartPanel(chartEl, opts = {}) {
  return new ChartPanel(chartEl, opts)
}

class ChartPanel {
  constructor(chartEl, { dark, xTime, rangerEl, formatX, onRangeChange } = {}) {
    this.chartEl = chartEl
    this.rangerEl = rangerEl || null
    this.xTime = xTime !== false
    this.formatX = typeof formatX === 'function' ? formatX : (x) => String(x)
    this.onRangeChange = typeof onRangeChange === 'function' ? onRangeChange : null
    this._handle = null
    this._ranger = null
    this.currentDef = null
    this.payload = null
    this.legendElement = null
    this.touchActive = false
    this.epoch = 0
    this._dark = dark != null ? dark : darkEnabled()
    this._destroyed = false
  }

  get handle() {
    return this._handle
  }

  get ranger() {
    return this._ranger
  }

  // (Re)build for `def`, feed `payload`, retain it for the tooltip. Recreates the handle on a
  // def REFERENCE change (not def.name), else setData. Async: createChart is async, so the
  // epoch guard also serializes overlapping renders.
  async render(def, payload, settings) {
    if (this._destroyed) return
    const epoch = ++this.epoch
    const cols = def.toColumns(payload || {}, settings || {})
    await this._ensureChart(def, epoch)
    if (epoch !== this.epoch || this._destroyed) return
    this.payload = payload
    this._handle.setData(cols)
  }

  async _ensureChart(def, epoch) {
    if (this._handle && def === this.currentDef) return // reuse
    if (this._ranger) {
      this._ranger.destroy()
      this._ranger = null
    }
    if (this._handle) {
      this._handle.destroy()
      this._handle = null
    }
    const handle = await createChart(this.chartEl, def, {
      dark: this._dark,
      width: this.chartEl.clientWidth || 800,
      height: this.chartEl.clientHeight || 300,
      xTime: this.xTime
    })
    if (epoch !== this.epoch || this._destroyed) {
      handle.destroy()
      return
    }
    this._handle = handle
    this.currentDef = def
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    if (this._handle) {
      this._handle.destroy()
      this._handle = null
    }
    if (this._ranger) {
      this._ranger.destroy()
      this._ranger = null
    }
  }
}
