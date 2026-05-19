import { Controller } from '@hotwired/stimulus'
import ws from '../services/messagesocket_service'

// Maps a ws connection state to the indicator. Only 'connected' is green;
// every other state (connecting, reconnecting, closed) is a non-green,
// honest "not live" signal — the dot no longer lies about a zombie socket.
const STATE_LABELS = {
  connected: ['Connected', true],
  connecting: ['Connecting…', false],
  reconnecting: ['Reconnecting…', false],
  closed: ['Disconnected', false]
}

export default class extends Controller {
  static get targets() {
    return ['indicator', 'status']
  }

  connect() {
    this.indicatorTarget.classList.remove('hidden')

    this.onConnState = (state) => {
      const [label, connected] = STATE_LABELS[state] || STATE_LABELS.closed
      this.updateConnectionStatus(label, connected)
    }
    ws.registerEvtHandler('connstate', this.onConnState)

    // Reflect the live state immediately — handles a Turbolinks re-connect of
    // this controller where the socket is already open (no 'connstate' event
    // would fire on its own).
    this.onConnState(ws.currentState)

    this.onPing = (evt) => {
      if (window.loggingDebug) console.debug('ping. users online: ', evt)
    }
    ws.registerEvtHandler('ping', this.onPing)
  }

  disconnect() {
    // Prevent handler accumulation across Turbolinks page loads.
    ws.deregisterEvtHandlers('connstate')
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
    if (window.Notification.permission === 'granted') return
    if (window.Notification.permission !== 'denied') window.Notification.requestPermission()
  }
}
