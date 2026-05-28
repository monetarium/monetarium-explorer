import { describe, test, expect, beforeEach, vi } from 'vitest'

// Capture every fake ReconnectingWebSocket the service constructs so tests can
// drive its lifecycle callbacks and inspect what was sent.
const instances = []

vi.mock('partysocket/ws', () => {
  class FakeReconnectingWebSocket {
    constructor(url, protocols, options) {
      this.url = url
      this.protocols = protocols
      this.options = options
      this.sent = []
      this.closed = false
      this.onopen = null
      this.onmessage = null
      this.onclose = null
      this.onerror = null
      instances.push(this)
    }

    send(data) {
      this.sent.push(data)
    }

    close() {
      this.closed = true
    }

    reconnect() {
      this.reconnectCalls = (this.reconnectCalls || 0) + 1
    }
  }
  return { default: FakeReconnectingWebSocket }
})

const { MessageSocket } = await import('./messagesocket_service')

const envelope = (event, message) => JSON.stringify({ event, message })

let ws
let socket

beforeEach(() => {
  instances.length = 0
  ws = new MessageSocket()
})

describe('MessageSocket', () => {
  test('buffers sends made before connect and flushes them on connect', () => {
    ws.send('getmempooltxs', 'id1')
    expect(instances).toHaveLength(0)

    ws.connect('ws://localhost/ws')
    socket = instances[0]

    expect(socket.sent).toEqual([envelope('getmempooltxs', 'id1')])
  })

  test('send after connect serializes the {event, message} envelope', () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]

    ws.send('decodetx', 'deadbeef')

    expect(socket.sent).toContain(envelope('decodetx', 'deadbeef'))
  })

  test('inbound message is forwarded to the matching event handler', () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]
    const handler = vi.fn()
    ws.registerEvtHandler('newblock', handler)

    socket.onmessage({ data: envelope('newblock', '{"height":42}') })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('{"height":42}')
  })

  test('discards an unparseable inbound frame without throwing or wedging the loop', () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]
    const handler = vi.fn()
    ws.registerEvtHandler('newblock', handler)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => socket.onmessage({ data: 'not json' })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(0)

    // The next valid frame is still forwarded.
    socket.onmessage({ data: envelope('newblock', '{"height":42}') })
    expect(handler).toHaveBeenCalledTimes(1)

    warn.mockRestore()
  })

  test("emits 'open' on every open but 'reconnect' only from the second open onward", () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]
    const openSpy = vi.fn()
    const reconnectSpy = vi.fn()
    ws.registerEvtHandler('open', openSpy)
    ws.registerEvtHandler('reconnect', reconnectSpy)

    socket.onopen() // initial connect
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(reconnectSpy).toHaveBeenCalledTimes(0)

    socket.onclose() // drop
    socket.onopen() // partysocket reconnected on the same instance
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(reconnectSpy).toHaveBeenCalledTimes(1)
  })

  test('registerEvtHandler returns an unsubscribe that removes only that handler', () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]
    const keep = vi.fn()
    const remove = vi.fn()
    ws.registerEvtHandler('newtxs', keep)
    const unsubscribe = ws.registerEvtHandler('newtxs', remove)

    unsubscribe()
    socket.onmessage({ data: envelope('newtxs', '[]') })

    expect(keep).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(0)
  })

  test('close() closes the underlying socket', () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]

    ws.close()

    expect(socket.closed).toBe(true)
  })

  test('does not send periodic app-level pings', () => {
    vi.useFakeTimers()
    try {
      ws.connect('ws://localhost/ws')
      socket = instances[0]
      socket.onopen()

      vi.advanceTimersByTime(60000)

      const pings = socket.sent.filter((p) => p.includes('"event":"ping"'))
      expect(pings).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('forces a reconnect when the server goes silent past the liveness window', () => {
    vi.useFakeTimers()
    try {
      ws.connect('ws://localhost/ws')
      socket = instances[0]
      socket.onopen()

      // Inbound traffic within the window is proof of life (server pushes an
      // app-level ping every 60 s), so the watchdog must not fire.
      vi.advanceTimersByTime(60000)
      socket.onmessage({ data: envelope('ping', '3') })
      vi.advanceTimersByTime(60000)
      expect(socket.reconnectCalls || 0).toBe(0)

      // A silent drop: the browser never fires close, so without a watchdog the
      // socket would linger in OPEN forever. The watchdog must force a reconnect.
      vi.advanceTimersByTime(90000)
      expect(socket.reconnectCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('inbound pings keep the connection alive without reconnecting', () => {
    vi.useFakeTimers()
    try {
      ws.connect('ws://localhost/ws')
      socket = instances[0]
      socket.onopen()

      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(60000)
        socket.onmessage({ data: envelope('ping', String(i)) })
      }
      vi.advanceTimersByTime(60000)

      expect(socket.reconnectCalls || 0).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a clean close stops the liveness watchdog', () => {
    vi.useFakeTimers()
    try {
      ws.connect('ws://localhost/ws')
      socket = instances[0]
      socket.onopen()

      ws.close()
      vi.advanceTimersByTime(120000)

      expect(socket.reconnectCalls || 0).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('passes reconnection options to the underlying socket', () => {
    ws.connect('ws://localhost/ws')
    socket = instances[0]

    expect(socket.options).toMatchObject({ maxRetries: Infinity })
  })
})
