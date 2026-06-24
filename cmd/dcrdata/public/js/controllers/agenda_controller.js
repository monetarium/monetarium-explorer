import { Controller } from '@hotwired/stimulus'
import { debounce } from 'lodash-es'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { intComma } from '../charts/format'
import { createChart, resolveSeriesColor } from '../helpers/uplot_adapter'
import { createRanger } from '../helpers/uplot_ranger'
import { cumulativeVoteChoicesDef, voteChoicesByBlockDef } from '../charts/definitions/agenda'
import globalEventBus from '../services/event_bus_service'
import { darkEnabled } from '../services/theme_service'

// The agenda page shows TWO charts at once (unlike the address page's one-behind-a-selector):
// cumulative vote choices (stacked area, time axis) and vote choices by block (stacked bars,
// block-height axis). Each chart owns a uPlot handle, an overview "ranger" strip (parity with
// the old Dygraphs showRangeSelector), and an on-plot percentage tooltip. Zoom is ephemeral —
// the agenda page has no zoom controls or URL state, so a range change is not persisted.

export default class extends Controller {
  static get targets() {
    return [
      'cumulativeVoteChoices',
      'voteChoicesByBlock',
      'cumulativeRanger',
      'blockRanger',
      'legendEntry',
      'legendMarker'
    ]
  }

  async connect() {
    this.agendaId = this.data.get('id')
    this.element.classList.add('loading')
    this.setupLegendFactories()
    this.charts = this.buildChartSpecs()

    // Night-mode + resize listeners (removed in disconnect).
    this.processNightMode = () => this.redrawTheme()
    globalEventBus.on('NIGHT_MODE', this.processNightMode)
    this.onWindowResize = debounce(() => this.resizeCharts(), 150)
    window.addEventListener('resize', this.onWindowResize)

    const res = await requestJSON(`/api/agenda/${this.agendaId}`)
    this.charts[0].payload = (res && res.by_time) || null
    this.charts[1].payload = (res && res.by_height) || null
    for (const spec of this.charts) await this.renderChart(spec)
    this.element.classList.remove('loading')
  }

  disconnect() {
    if (this.charts) {
      this.charts.forEach((spec) => {
        if (spec.handle) {
          spec.handle.destroy()
          spec.handle = null
        }
        if (spec.ranger) {
          spec.ranger.destroy()
          spec.ranger = null
        }
      })
    }
    globalEventBus.off('NIGHT_MODE', this.processNightMode)
    window.removeEventListener('resize', this.onWindowResize)
  }

  // Per-chart specs. xLabel formats the tooltip's x value: a UTC date for the time chart,
  // the exact block height for the by-block chart.
  buildChartSpecs() {
    return [
      {
        key: 'cumulative',
        chartTarget: this.cumulativeVoteChoicesTarget,
        rangerTarget: this.hasCumulativeRangerTarget ? this.cumulativeRangerTarget : null,
        def: cumulativeVoteChoicesDef(),
        xTime: true,
        xLabel: (x) => `Date: ${humanize.date(x * 1000)}`,
        handle: null,
        ranger: null,
        legendElement: null,
        payload: null
      },
      {
        key: 'byBlock',
        chartTarget: this.voteChoicesByBlockTarget,
        rangerTarget: this.hasBlockRangerTarget ? this.blockRangerTarget : null,
        def: voteChoicesByBlockDef(),
        xTime: false,
        xLabel: (x) => `Block Height: ${intComma(x)}`,
        handle: null,
        ranger: null,
        legendElement: null,
        payload: null
      }
    ]
  }

  // Clone the hidden legend seed nodes from the markup into row/marker factories shared by
  // both charts' tooltips (mirrors the address controller). Fall back to plain text nodes
  // when the seeds are absent (keeps unit tests that stub these out working).
  setupLegendFactories() {
    if (this.hasLegendMarkerTarget) {
      const lm = this.legendMarkerTarget
      lm.remove()
      lm.removeAttribute('data-agenda-target')
      this.legendMarker = (color) => {
        const node = document.createElement('div')
        const marker = lm.cloneNode()
        if (color) marker.style.borderBottomColor = color
        node.appendChild(marker)
        return node.innerHTML
      }
    } else {
      this.legendMarker = (_color) => ''
    }
    if (this.hasLegendEntryTarget) {
      const le = this.legendEntryTarget
      le.remove()
      le.removeAttribute('data-agenda-target')
      this.legendEntry = (s) => {
        const node = le.cloneNode()
        node.innerHTML = s
        return node
      }
    } else {
      this.legendEntry = (s) => {
        const node = document.createElement('div')
        node.textContent = s
        return node
      }
    }
  }

  // (Re)create one chart's uPlot handle + overview ranger from its payload.
  async renderChart(spec) {
    const def = spec.def
    const cols = def.toColumns(spec.payload || {}, {})
    const opts = {
      dark: darkEnabled(),
      width: spec.chartTarget.clientWidth || 800,
      height: spec.chartTarget.clientHeight || 300,
      xTime: spec.xTime,
      hooks: this.buildHooks(spec),
      onRangeChange: (min, max) => this.onChartRangeChange(spec, min, max)
    }
    if (spec.handle) spec.handle.destroy()
    spec.handle = await createChart(spec.chartTarget, def, opts)
    spec.handle.setData(cols)
    await this.recreateRanger(spec, cols)
  }

  buildHooks(spec) {
    return {
      ready: [(u) => this.installTooltip(u, spec)],
      setCursor: [(u) => this.renderLegend(u, spec)],
      draw: [(u) => this.syncRangerGutters(u, spec)]
    }
  }

  // Plot-box insets (root->over gap) in CSS px, used to align the ranger strip under the
  // main chart. Null until layout exists. Ported from the address controller.
  measureGutters(u) {
    if (!u || !u.over || !u.root) return null
    const root = u.root.getBoundingClientRect()
    const over = u.over.getBoundingClientRect()
    return { left: over.left - root.left, right: root.right - over.right }
  }

  syncRangerGutters(u, spec) {
    if (!spec.ranger) return
    const g = this.measureGutters(u)
    if (g) spec.ranger.setGutters(g.left, g.right)
  }

  installTooltip(u, spec) {
    if (!u || !u.over) return
    const tt = document.createElement('div')
    tt.className = 'chart-tooltip d-hide'
    u.over.appendChild(tt)
    spec.legendElement = tt
    u.over.addEventListener('mouseenter', () => tt.classList.remove('d-hide'))
    u.over.addEventListener('mouseleave', () => {
      if (!u.cursor || !u.cursor._lock) tt.classList.add('d-hide')
    })
  }

  positionTooltip(u, spec) {
    const tt = spec.legendElement
    if (!u.over || !tt || !tt.style) return
    const pad = 12
    let left = u.cursor.left + pad
    let top = u.cursor.top + pad
    if (left + tt.offsetWidth > u.over.clientWidth) left = u.cursor.left - tt.offsetWidth - pad
    if (top + tt.offsetHeight > u.over.clientHeight) top = u.cursor.top - tt.offsetHeight - pad
    tt.style.left = `${Math.max(0, left)}px`
    tt.style.top = `${Math.max(0, top)}px`
  }

  // Render the tooltip at the current cursor index: x label, then every visible series as
  // "Label: count (pct%)". Unlike the address stacked charts, agenda shows all three vote
  // series even at 0 (parity with the old agendasLegendFormatter, which never skipped zeros).
  renderLegend(u, spec) {
    const tt = spec.legendElement
    if (!tt) return
    const idx = u.cursor.idx
    if (idx == null) {
      tt.classList.add('d-hide')
      return
    }
    tt.classList.remove('d-hide')
    tt.replaceChildren()
    const x = u.data[0][idx]
    tt.appendChild(this.legendEntry(spec.xLabel(x)))
    const dark = darkEnabled()
    spec.def.series.forEach((s, i) => {
      if (u.series && u.series[i + 1] && u.series[i + 1].show === false) return
      const value = u.data[i + 1][idx]
      if (value == null) return
      const text = spec.def.formatValue(i, { idx: idx, payload: spec.payload, value: value }, {})
      const color = resolveSeriesColor(s, i, dark)
      tt.appendChild(this.legendEntry(`${this.legendMarker(color)} ${s.label}: ${text}`))
    })
    this.positionTooltip(u, spec)
  }

  // (Re)create the overview ranger strip for a chart from its primary (Yes) series.
  async recreateRanger(spec, cols) {
    if (spec.ranger) {
      spec.ranger.destroy()
      spec.ranger = null
    }
    if (!spec.rangerTarget) return
    const g = (spec.handle && this.measureGutters(spec.handle.uplot)) || { left: 0, right: 0 }
    spec.ranger = await createRanger(spec.rangerTarget, spec.def, {
      dark: darkEnabled(),
      width: spec.rangerTarget.clientWidth || 800,
      xTime: spec.xTime,
      leftGutter: g.left,
      rightGutter: g.right,
      onSelect: (min, max) => this.onRangerSelect(spec, min, max)
    })
    spec.ranger.setData([cols[0], cols[1]])
    // Now that the ranger exists, align its plot insets to the main chart's and seed the
    // selection window to the full data extent. Both are deferred because uPlot commits the
    // fresh chart/strip layout asynchronously: (1) the gutter seed in this method ran before
    // the main chart had its real (data-driven) y-axis width, and the corrective `draw`-hook
    // sync fired while the ranger was still being constructed (spec.ranger was null) — the
    // agenda page, unlike address, has no post-render setXRange to trigger another draw, so
    // without this the strip spans the full container width and ignores the y-axis gutter;
    // (2) setSelection's valToPos needs the strip's post-gutter layout, so it waits one more
    // microtask after the gutter relayout (mirrors resizeCharts). Otherwise the strip shows
    // no range window on load.
    const xs = cols[0]
    queueMicrotask(() => {
      if (!spec.ranger) return
      this.syncRangerGutters(spec.handle.uplot, spec)
      queueMicrotask(() => {
        if (spec.ranger && xs && xs.length) spec.ranger.setSelection(xs[0], xs[xs.length - 1])
      })
    })
  }

  // Main-chart drag-zoom -> mirror onto the ranger window (ephemeral; not persisted).
  onChartRangeChange(spec, min, max) {
    if (spec.ranger) spec.ranger.setSelection(min, max)
  }

  // Ranger grip/body drag -> drive the main chart's x-range.
  onRangerSelect(spec, min, max) {
    if (spec.handle) spec.handle.setXRange(min, max)
  }

  // Re-theme both charts + rangers, preserving each main chart's current x-range and
  // re-applying it to the freshly-rebuilt (selection-less) ranger. Mirrors the address
  // controller's microtask-deferred selection restore (uPlot commits scale/layout async).
  redrawTheme() {
    const dark = darkEnabled()
    if (!this.charts) return
    this.charts.forEach((spec) => {
      const sx = spec.handle && spec.handle.uplot.scales.x
      const range = sx && sx.min != null && sx.max != null ? [sx.min, sx.max] : null
      if (spec.handle) spec.handle.setDark(dark)
      if (spec.ranger) {
        spec.ranger.setDark(dark)
        queueMicrotask(() => {
          if (!spec.ranger) return
          if (range) spec.ranger.setSelection(range[0], range[1])
          else {
            const xs = spec.ranger.uplot.data[0]
            if (xs && xs.length) spec.ranger.setSelection(xs[0], xs[xs.length - 1])
          }
        })
      }
    })
  }

  resizeCharts() {
    if (!this.charts) return
    this.charts.forEach((spec) => {
      if (!spec.handle) return
      spec.handle.resize(spec.chartTarget.clientWidth || 800, spec.chartTarget.clientHeight || 300)
      if (!spec.ranger || !spec.rangerTarget) return
      spec.ranger.setWidth(spec.rangerTarget.clientWidth || 800)
      const sx = spec.handle.uplot.scales.x
      if (sx && sx.min != null && sx.max != null) {
        const min = sx.min
        const max = sx.max
        queueMicrotask(() => {
          if (spec.ranger) spec.ranger.setSelection(min, max)
        })
      }
    })
  }
}
