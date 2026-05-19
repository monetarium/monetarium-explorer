// MessageSocket is a WebSocket manager with an assumed JSON message format.
//
// JSON message format:
// {
//   event: name,
//   message: your message data
// }
//
// Functions for external use:
// registerEvtHandler(id, handler_function) -- register a function to handle
//     events of the given type
// send(id, data) -- create a JSON message in the above format and send it
//
// Beyond plain message passing it keeps the connection alive on flaky / mobile
// networks: a client-side heartbeat detects silently-dead ("zombie") sockets
// that never fire onclose/onerror (common on iOS WebKit), and it
// auto-reconnects with capped exponential backoff. Registered handlers survive
// reconnects, so page init does not need to re-run. Connection liveness is
// surfaced via a synthetic 'connstate' event.
//
// Copyright (c) 2017, Jonathan Chappelow
// See LICENSE for details.
//
// Based on ws_events_dispatcher.js by Ismael Celis

const WS_OPEN = 1 // WebSocket.OPEN

const PING_INTERVAL_MS = 7000 // keep-alive: server closes after 60s of silence
const HEARTBEAT_CHECK_MS = 15000
// The browser /ws gets an inbound frame at most every ~60s (the explorer
// pingAndUserCount). The timeout must comfortably exceed that to avoid
// false positives on a healthy idle connection.
const HEARTBEAT_TIMEOUT_MS = 90000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
// A socket is "demonstrably alive" only if a frame arrived very recently.
const ALIVE_WINDOW_MS = 10000

function forward(event, message, handlers) {
  if (typeof handlers[event] === 'undefined') return
  // call each handler
  for (let i = 0; i < handlers[event].length; i++) {
    handlers[event][i](message)
  }
}

class MessageSocket {
  constructor() {
    this.uri = undefined
    this.connection = undefined
    this.handlers = {}
    this.queue = []
    this.maxQlength = 5
    this.state = 'closed' // 'connecting' | 'connected' | 'reconnecting' | 'closed'
    this.lastMessageAt = 0
    this.reconnectAttempts = 0
    this.manualClose = false
    this.pingTimer = null
    this.heartbeatTimer = null
    this.reconnectTimer = null
    this.triggersBound = false
  }

  get currentState() {
    return this.state
  }

  registerEvtHandler(eventID, handler) {
    this.handlers[eventID] = this.handlers[eventID] || []
    this.handlers[eventID].push(handler)
  }

  deregisterEvtHandlers(eventID) {
    this.handlers[eventID] = []
  }

  // send a message back to the server
  send(eventID, message) {
    if (this.connection === undefined || this.connection.readyState !== WS_OPEN) {
      while (this.queue.length > this.maxQlength - 1) this.queue.shift()
      this.queue.push([eventID, message])
      return
    }
    const payload = JSON.stringify({
      event: eventID,
      message: message
    })

    if (window.loggingDebug) console.log('send', payload)
    try {
      this.connection.send(payload)
    } catch (e) {
      console.log('ws send failed, reconnecting:', e)
      this._scheduleReconnect()
    }
  }

  connect(uri) {
    this.uri = uri
    this.manualClose = false
    this._bindProactiveTriggers()
    this._open()
  }

  // close performs a deliberate shutdown: no reconnect, but handlers are
  // intentionally retained so a later connect() resumes without page init.
  close(reason) {
    console.log('ws manual close:', reason)
    this.manualClose = true
    this._clearTimers()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this._detachSocket()
    this._setState('closed')
  }

  _open() {
    this._clearTimers()
    this._setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    const socket = new window.WebSocket(this.uri)
    this.connection = socket

    socket.onmessage = (evt) => {
      this.lastMessageAt = Date.now()
      if (this.state !== 'connected') this._setState('connected')
      let json
      try {
        json = JSON.parse(evt.data)
      } catch (e) {
        console.log('ws: bad JSON frame:', e)
        return
      }
      forward(json.event, json.message, this.handlers)
    }

    socket.onopen = () => {
      this.reconnectAttempts = 0
      this.lastMessageAt = Date.now()
      this._setState('connected')
      forward('open', null, this.handlers)
      this._startPing()
      this._startHeartbeat()
      while (this.queue.length) {
        const [eventID, message] = this.queue.shift()
        this.send(eventID, message)
      }
    }

    socket.onclose = () => {
      forward('close', null, this.handlers)
      this._onConnectionLost()
    }

    socket.onerror = (evt) => {
      forward('error', evt, this.handlers)
      this._onConnectionLost()
    }
  }

  _onConnectionLost() {
    this._clearTimers()
    if (this.manualClose) return
    this._scheduleReconnect()
  }

  _backoffDelay(attempt) {
    return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose) return
    // Discard the current socket so a late onclose/onerror from it cannot
    // double-trigger a reconnect.
    this._detachSocket()
    this._setState('reconnecting')
    const delay = this._backoffDelay(this.reconnectAttempts) + Math.floor(Math.random() * 250)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._open()
    }, delay)
  }

  // _reconnectIfStale reconnects right now (ignoring backoff) unless the socket
  // is demonstrably alive. Used by the proactive foreground/online triggers.
  _reconnectIfStale() {
    if (this.manualClose) return
    const alive =
      this.state === 'connected' &&
      this.connection &&
      this.connection.readyState === WS_OPEN &&
      Date.now() - this.lastMessageAt < ALIVE_WINDOW_MS
    if (alive) return
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0
    this._detachSocket()
    this._open()
  }

  _bindProactiveTriggers() {
    if (this.triggersBound) return
    this.triggersBound = true
    this._onVisible = () => {
      if (document.visibilityState === 'visible') this._reconnectIfStale()
    }
    this._onOnline = () => this._reconnectIfStale()
    document.addEventListener('visibilitychange', this._onVisible)
    window.addEventListener('online', this._onOnline)
  }

  _startPing() {
    clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => this.send('ping', 'sup'), PING_INTERVAL_MS)
  }

  _startHeartbeat() {
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'connected') return
      if (Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
        console.log('ws heartbeat timeout; socket is a zombie, reconnecting')
        this._scheduleReconnect()
      }
    }, HEARTBEAT_CHECK_MS)
  }

  _clearTimers() {
    clearInterval(this.pingTimer)
    this.pingTimer = null
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  _detachSocket() {
    const c = this.connection
    if (!c) return
    c.onopen = c.onmessage = c.onclose = c.onerror = null
    try {
      c.close()
    } catch (e) {
      console.log('ws: error closing stale socket:', e)
    }
    this.connection = undefined
  }

  _setState(state) {
    if (this.state === state) return
    this.state = state
    forward('connstate', state, this.handlers)
  }
}

const ws = new MessageSocket()
export default ws
export { MessageSocket }
