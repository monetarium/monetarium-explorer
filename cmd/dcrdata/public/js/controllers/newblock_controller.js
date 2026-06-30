import { Controller } from '@hotwired/stimulus'
import globalEventBus from '../services/event_bus_service'

export default class extends Controller {
  static get targets() {
    return ['confirmations']
  }

  connect() {
    this.confirmationsTargets.forEach((el, _i) => {
      if (!el.dataset.confirmations) return
      this.setConfirmationText(el, el.dataset.confirmations)
    })
    this._blockReceived = (data) => this.refreshConfirmations(data.block.height)
    globalEventBus.on('BLOCK_RECEIVED', this._blockReceived)
  }

  disconnect() {
    globalEventBus.off('BLOCK_RECEIVED', this._blockReceived)
  }

  setConfirmationText(el, confirmations) {
    if (confirmations > 0) {
      el.textContent = el.dataset.yes
        .replace('#', confirmations)
        .replace('@', confirmations > 1 ? 's' : '')
      el.classList.add('confirmed')
    } else {
      el.textContent = el.dataset.no
      el.classList.remove('confirmed')
    }
  }

  refreshConfirmations(expHeight) {
    this.confirmationsTargets.forEach((el, _i) => {
      const confirmHeight = parseInt(el.dataset.confirmationBlockHeight)
      if (confirmHeight === -1) return // Unconfirmed block
      const confirmations = expHeight - confirmHeight + 1
      this.setConfirmationText(el, confirmations)
      el.dataset.confirmations = confirmations
    })
  }
}
