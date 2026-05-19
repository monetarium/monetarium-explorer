import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageSocket } from './messagesocket_service'

// Service constants (kept in sync with messagesocket_service.js).
const HEARTBEAT_TIMEOUT_MS = 90000
const HEARTBEAT_CHECK_MS = 15000

class MockWebSocket {
  static instances = []
  constructor(uri) {
    this.uri = uri
    this.readyState = 0 // CONNECTING
    this.sent = []
    this.onopen = this.onmessage = this.onclose = this.onerror = null
    MockWebSocket.instances.push(this)
  }

  send(payload) {
    if (this.readyState !== 1) throw new Error('socket not open')
    this.sent.push(payload)
  }

  close() {
    this.readyState = 3 // CLOSED
    if (this.onclose) this.onclose()
  }

  // --- test driver helpers ---
  open() {
    this.readyState = 1 // OPEN
    if (this.onopen) this.onopen()
  }

  message(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) })
  }

  serverClose() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }

  errored() {
    if (this.onerror) this.onerror(new Error('ws error'))
  }
}

const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]

describe('MessageSocket', () => {
  let sock

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    window.WebSocket = MockWebSocket
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })
    sock = new MessageSocket()
  })

  afterEach(() => {
    // Unbind the global document/window listeners this instance registered so
    // it cannot affect other tests.
    if (sock._onVisible) document.removeEventListener('visibilitychange', sock._onVisible)
    if (sock._onOnline) window.removeEventListener('online', sock._onOnline)
    vi.useRealTimers()
  })

  it('keeps registered handlers across an auto-reconnect (the core bug)', () => {
    const fn = vi.fn()
    sock.registerEvtHandler('newblock', fn)
    sock.connect('ws://x/ws')

    const w1 = latest()
    w1.open()
    w1.serverClose() // server tore down the connection

    vi.advanceTimersByTime(2000) // let backoff fire
    const w2 = latest()
    expect(w2).not.toBe(w1)

    w2.open()
    w2.message({ event: 'newblock', message: 'block-data' })
    expect(fn).toHaveBeenCalledWith('block-data')
  })

  it('detects a silent zombie socket via heartbeat timeout and reconnects', () => {
    sock.connect('ws://x/ws')
    latest().open()

    // No frames arrive at all (onclose/onerror never fire — the iOS case).
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_CHECK_MS + 1)
    vi.advanceTimersByTime(2000) // backoff delay

    expect(MockWebSocket.instances.length).toBe(2)
  })

  it('does NOT reconnect while frames keep arriving within the timeout', () => {
    sock.connect('ws://x/ws')
    const w1 = latest()
    w1.open()

    // A frame every 20s for 200s — well over the heartbeat timeout in total,
    // but never a 90s gap.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(20000)
      w1.message({ event: 'ping', message: '1' })
    }

    expect(MockWebSocket.instances.length).toBe(1)
  })

  it('uses capped exponential backoff', () => {
    expect(sock._backoffDelay(0)).toBe(1000)
    expect(sock._backoffDelay(1)).toBe(2000)
    expect(sock._backoffDelay(2)).toBe(4000)
    expect(sock._backoffDelay(5)).toBe(30000) // 32000 capped
    expect(sock._backoffDelay(20)).toBe(30000)
  })

  it('resets the backoff attempt counter after a successful open', () => {
    sock.connect('ws://x/ws')
    latest().open()
    latest().serverClose()
    vi.advanceTimersByTime(2000)
    expect(sock.reconnectAttempts).toBeGreaterThan(0)

    latest().open() // reconnected successfully
    expect(sock.reconnectAttempts).toBe(0)
  })

  it('reconnects immediately when the tab becomes visible and the socket is stale', () => {
    sock.connect('ws://x/ws')
    latest().open()

    vi.advanceTimersByTime(11000) // no frames -> stale
    document.dispatchEvent(new window.Event('visibilitychange'))

    expect(MockWebSocket.instances.length).toBe(2)
  })

  it('does not reconnect on visibilitychange when the socket is demonstrably alive', () => {
    sock.connect('ws://x/ws')
    const w1 = latest()
    w1.open()
    w1.message({ event: 'ping', message: '1' }) // fresh frame

    document.dispatchEvent(new window.Event('visibilitychange'))

    expect(MockWebSocket.instances.length).toBe(1)
  })

  it('reconnects on the window "online" event when stale', () => {
    sock.connect('ws://x/ws')
    latest().open()

    vi.advanceTimersByTime(11000)
    window.dispatchEvent(new window.Event('online'))

    expect(MockWebSocket.instances.length).toBe(2)
  })

  it('manual close() does not reconnect and retains handlers', () => {
    const fn = vi.fn()
    sock.registerEvtHandler('newblock', fn)
    sock.connect('ws://x/ws')
    latest().open()

    sock.close('navigating away')
    latest().serverClose() // a late close must not trigger reconnect
    vi.advanceTimersByTime(120000)

    expect(MockWebSocket.instances.length).toBe(1)
    expect(sock.handlers.newblock).toContain(fn)
  })

  it('emits connstate transitions for the liveness indicator', () => {
    const states = []
    sock.registerEvtHandler('connstate', (s) => states.push(s))
    sock.connect('ws://x/ws')
    latest().open()
    expect(states).toContain('connected')

    latest().serverClose()
    expect(states).toContain('reconnecting')
  })
})
