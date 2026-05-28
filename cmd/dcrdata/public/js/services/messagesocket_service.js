// MessageSocket is a WebSocket manager with an assumed JSON message format.
// It wraps partysocket's ReconnectingWebSocket, so a dropped connection is
// re-established automatically with exponential backoff and outbound messages
// are buffered across reconnects.
//
// JSON message format:
// {
//   event: name,
//   message: your message data
// }
//
// Functions for external use:
// registerEvtHandler(id, handler) -- register a handler for events of the given
//     type; returns an unsubscribe function that removes just that handler.
// deregisterEvtHandler(id, handler) -- remove a single handler.
// deregisterEvtHandlers(id) -- remove all handlers for an event.
// send(id, data) -- create a JSON message in the above format and send it.
//
// Synthetic events, in addition to the server's event names:
//   open      -- fired on every (re)connection
//   reconnect -- fired on every connection after the first, so consumers can
//                re-request server state that was missed while disconnected
//   close     -- fired when the underlying socket drops
//   error     -- fired on socket errors
//
import ReconnectingWebSocket from 'partysocket/ws'

// reconnectOptions tune partysocket's own reconnection: exponential backoff
// between attempts (min/max delay + grow factor), how long to wait for a socket
// to open before retrying (connectionTimeout), and unbounded retries/outbound
// buffering so a transient outage recovers without dropping queued sends.
const reconnectOptions = {
  minReconnectionDelay: 1000,
  maxReconnectionDelay: 10000,
  reconnectionDelayGrowFactor: 1.3,
  connectionTimeout: 4000,
  maxRetries: Infinity,
  maxEnqueuedMessages: Infinity
}

function forward(event, message, handlers) {
  const list = handlers[event]
  if (!list) return
  // Iterate a copy so a handler may unsubscribe itself during dispatch.
  for (const handler of list.slice()) handler(message)
}

class MessageSocket {
  constructor() {
    this.uri = undefined
    this.connection = undefined
    this.handlers = {}
    // Buffers sends issued before connect() runs (controllers send on Stimulus
    // connect, which precedes the deferred ws.connect in index.js).
    this.preConnectQueue = []
    this.maxQlength = 5
    this.hasConnected = false
  }

  registerEvtHandler(eventID, handler) {
    const list = this.handlers[eventID] || (this.handlers[eventID] = [])
    list.push(handler)
    return () => this.deregisterEvtHandler(eventID, handler)
  }

  deregisterEvtHandler(eventID, handler) {
    const list = this.handlers[eventID]
    if (!list) return
    const idx = list.indexOf(handler)
    if (idx !== -1) list.splice(idx, 1)
  }

  deregisterEvtHandlers(eventID) {
    this.handlers[eventID] = []
  }

  // send a message back to the server
  send(eventID, message) {
    const payload = JSON.stringify({
      event: eventID,
      message: message
    })

    if (this.connection === undefined) {
      while (this.preConnectQueue.length > this.maxQlength - 1) this.preConnectQueue.shift()
      this.preConnectQueue.push(payload)
      return
    }

    if (window.loggingDebug) console.log('send', payload)
    this.connection.send(payload)
  }

  connect(uri) {
    this.uri = uri
    this.connection = new ReconnectingWebSocket(uri, [], {
      ...reconnectOptions,
      debug: Boolean(window.loggingDebug)
    })

    // Flush anything queued before the socket existed. partysocket buffers
    // these internally until the connection actually opens.
    while (this.preConnectQueue.length) {
      this.connection.send(this.preConnectQueue.shift())
    }

    // unmarshal message, and forward the message to registered handlers
    this.connection.onmessage = (evt) => {
      const json = JSON.parse(evt.data)
      forward(json.event, json.message, this.handlers)
    }

    this.connection.onopen = () => {
      forward('open', null, this.handlers)
      if (this.hasConnected) {
        forward('reconnect', null, this.handlers)
      }
      this.hasConnected = true
    }

    this.connection.onclose = () => {
      forward('close', null, this.handlers)
    }

    this.connection.onerror = (evt) => {
      forward('error', evt, this.handlers)
    }
  }

  // close terminates the connection without reconnecting (a clean close).
  close() {
    if (this.connection) this.connection.close()
  }
}

const ws = new MessageSocket()
export default ws
export { MessageSocket }
