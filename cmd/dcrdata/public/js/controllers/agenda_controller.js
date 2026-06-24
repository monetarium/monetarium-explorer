import { Controller } from '@hotwired/stimulus'
import { requestJSON } from '../helpers/http'
import humanize from '../helpers/humanize_helper'
import { intComma } from '../charts/format'
import { createChartPanel } from '../helpers/chart_panel'
import { cumulativeVoteChoicesDef, voteChoicesByBlockDef } from '../charts/definitions/agenda'

// The agenda page shows two charts at once: cumulative vote choices (stacked area, time axis)
// and vote choices by block (stacked bars, block-height axis). Each is a self-contained
// ChartPanel (chart + mouse/touch tooltip + ranger + theme + resize); this controller only
// fetches the data and hands each panel its definition. Zoom is ephemeral (no URL state).

export default class extends Controller {
  static get targets() {
    return ['cumulativeVoteChoices', 'voteChoicesByBlock', 'cumulativeRanger', 'blockRanger']
  }

  async connect() {
    this.agendaId = this.data.get('id')
    this.element.classList.add('loading')
    this.panels = [
      {
        panel: createChartPanel(this.cumulativeVoteChoicesTarget, {
          xTime: true,
          rangerEl: this.hasCumulativeRangerTarget ? this.cumulativeRangerTarget : null,
          formatX: (x) => `Date: ${humanize.date(x * 1000)}`
        }),
        def: cumulativeVoteChoicesDef(),
        field: 'by_time'
      },
      {
        panel: createChartPanel(this.voteChoicesByBlockTarget, {
          xTime: false,
          rangerEl: this.hasBlockRangerTarget ? this.blockRangerTarget : null,
          formatX: (x) => `Block Height: ${intComma(x)}`
        }),
        def: voteChoicesByBlockDef(),
        field: 'by_height'
      }
    ]
    const res = await requestJSON(`/api/agenda/${this.agendaId}`)
    // Render both panels in parallel — they are independent, so serializing their
    // createChart/loadUPlot calls would just double the wall-clock time.
    await Promise.all(
      this.panels.map((p) => p.panel.render(p.def, (res && res[p.field]) || {}, {}))
    )
    this.element.classList.remove('loading')
  }

  disconnect() {
    if (this.panels) this.panels.forEach((p) => p.panel.destroy())
  }
}
