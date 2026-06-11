// Safe wrappers around the Web Notifications API. Some browsers — notably iOS
// Safari tabs — do not expose window.Notification at all, so reading
// window.Notification.permission throws a TypeError. Accessed unguarded from a
// shared event-bus subscriber (notifyNewBlock), that throw aborts publish() and
// freezes every later subscriber, including the latest-blocks table. These
// helpers degrade to no-ops where the API is missing.

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

// notificationPermission returns the browser's permission string, or
// 'unsupported' when the Notification API is unavailable.
export function notificationPermission() {
  return notificationsSupported() ? window.Notification.permission : 'unsupported'
}

// requestNotifyPermission prompts for notification permission only when the API
// exists and the user has not already decided. No-op otherwise.
export function requestNotifyPermission() {
  if (!notificationsSupported()) return
  if (window.Notification.permission === 'granted') return
  if (window.Notification.permission !== 'denied') window.Notification.requestPermission()
}
