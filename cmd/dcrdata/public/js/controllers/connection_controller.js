import { Controller } from '@hotwired/stimulus'
import { requestNotifyPermission as requestNotifyPermissionSafe } from '../helpers/notification_helper'
import ws from '../services/messagesocket_service'

export default class extends Controller {
  static get targets() {
    return ['indicator', 'status']
  }

  connect() {
    this.indicatorTarget.classList.remove('hidden')

    ws.registerEvtHandler('open', () => {
      if (window.loggingDebug) console.log('Connected')
      this.updateConnectionStatus('Connected', true)
    })

    ws.registerEvtHandler('close', () => {
      console.log('Disconnected')
      this.updateConnectionStatus('Disconnected', false)
    })

    ws.registerEvtHandler('error', (evt) => {
      console.log('WebSocket error:', evt)
      this.updateConnectionStatus('Disconnected', false)
    })

    ws.registerEvtHandler('ping', (evt) => {
      if (window.loggingDebug) console.debug('ping. users online: ', evt)
    })
  }

  disconnect() {
    ws.deregisterEvtHandlers('open')
    ws.deregisterEvtHandlers('close')
    ws.deregisterEvtHandlers('error')
    ws.deregisterEvtHandlers('ping')
  }

  updateConnectionStatus(msg, connected) {
    if (connected) {
      this.indicatorTarget.classList.add('connected')
      this.indicatorTarget.classList.remove('disconnected')
    } else {
      this.indicatorTarget.classList.remove('connected')
      this.indicatorTarget.classList.add('disconnected')
    }
    this.statusTarget.textContent = `${msg} `
  }

  requestNotifyPermission() {
    requestNotifyPermissionSafe()
  }
}
