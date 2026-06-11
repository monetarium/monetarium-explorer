import { afterEach, describe, expect, it, vi } from 'vitest'
import globalEventBus from './event_bus_service'

// Regression: one BLOCK_RECEIVED subscriber throwing (e.g. notifyNewBlock on
// iOS Safari, where window.Notification is undefined) used to abort publish()'s
// forEach, silently preventing every later subscriber — including the latest-
// blocks table controller — from running. Subscribers must be isolated.
describe('EventBus.publish — subscriber error isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs later subscribers even when an earlier one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls = []
    const throwing = () => {
      calls.push('throwing')
      throw new TypeError(
        "undefined is not an object (evaluating 'window.Notification.permission')"
      )
    }
    const good = () => {
      calls.push('good')
    }
    globalEventBus.on('TEST_ISOLATION', throwing)
    globalEventBus.on('TEST_ISOLATION', good)

    globalEventBus.publish('TEST_ISOLATION', {})

    expect(calls).toEqual(['throwing', 'good'])

    globalEventBus.off('TEST_ISOLATION', throwing)
    globalEventBus.off('TEST_ISOLATION', good)
  })

  it('logs the error from a throwing subscriber instead of failing silently', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwing = () => {
      throw new Error('boom')
    }
    globalEventBus.on('TEST_LOG', throwing)

    globalEventBus.publish('TEST_LOG', {})

    expect(errSpy).toHaveBeenCalled()

    globalEventBus.off('TEST_LOG', throwing)
  })
})
