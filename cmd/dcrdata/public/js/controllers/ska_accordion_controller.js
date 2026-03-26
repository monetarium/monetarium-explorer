import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets() {
    return ['blockRow', 'subRow']
  }

  toggle(event) {
    // Let clicks on the Height link navigate normally — don't expand/collapse.
    if (event.target && event.target.closest && event.target.closest('a')) {
      return
    }

    const row = event.currentTarget.closest('tr')
    if (!row) return
    const blockId = row.dataset.blockId
    const subRows = this.subRowTargets.filter((r) => r.dataset.blockId === blockId)
    if (subRows.length === 0) return
    const isExpanded = subRows[0].classList.contains('ska-sub-row--visible')
    subRows.forEach((r) => r.classList.toggle('ska-sub-row--visible', !isExpanded))
    row.classList.toggle('is-expanded', !isExpanded)
  }
}
