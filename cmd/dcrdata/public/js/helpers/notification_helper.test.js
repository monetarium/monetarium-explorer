import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  notificationPermission,
  notificationsSupported,
  requestNotifyPermission
} from './notification_helper'

// iOS Safari tabs (and other browsers) do not expose window.Notification, so
// reading window.Notification.permission throws a TypeError. These helpers must
// degrade to no-ops rather than throw — a throw here freezes the live UI via
// the shared event bus (see event_bus_service.test.js).
describe('notification_helper — degrades gracefully without the Notification API', () => {
  afterEach(() => {
    delete window.Notification
    vi.restoreAllMocks()
  })

  it('notificationsSupported() is false when window.Notification is undefined', () => {
    delete window.Notification
    expect(notificationsSupported()).toBe(false)
  })

  it('notificationPermission() returns "unsupported" instead of throwing when the API is missing', () => {
    delete window.Notification
    expect(() => notificationPermission()).not.toThrow()
    expect(notificationPermission()).toBe('unsupported')
  })

  it('requestNotifyPermission() is a no-op (no throw) when the API is missing', () => {
    delete window.Notification
    expect(() => requestNotifyPermission()).not.toThrow()
  })

  it('notificationPermission() reflects the browser permission when supported', () => {
    window.Notification = { permission: 'granted', requestPermission: vi.fn() }
    expect(notificationsSupported()).toBe(true)
    expect(notificationPermission()).toBe('granted')
  })

  it('requestNotifyPermission() asks for permission only when undecided', () => {
    const requestPermission = vi.fn()
    window.Notification = { permission: 'default', requestPermission: requestPermission }
    requestNotifyPermission()
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('requestNotifyPermission() does not re-ask when already granted', () => {
    const requestPermission = vi.fn()
    window.Notification = { permission: 'granted', requestPermission: requestPermission }
    requestNotifyPermission()
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('requestNotifyPermission() does not ask when permission was denied', () => {
    const requestPermission = vi.fn()
    window.Notification = { permission: 'denied', requestPermission: requestPermission }
    requestNotifyPermission()
    expect(requestPermission).not.toHaveBeenCalled()
  })
})
