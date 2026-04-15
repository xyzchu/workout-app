// Take control of all pages immediately on activation so controller is
// non-null without needing a page reload
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()))

let notifTimer = null
let notifResolve = null

const cancelPending = () => {
  if (notifTimer !== null) { clearTimeout(notifTimer); notifTimer = null }
  if (notifResolve !== null) { notifResolve(); notifResolve = null }
}

self.addEventListener('message', (e) => {
  const { type, endsAt, title, body } = e.data || {}

  cancelPending()

  if (type === 'SCHEDULE') {
    const delay = endsAt - Date.now()
    if (delay <= 0) return
    // e.waitUntil keeps the SW alive until the notification fires
    e.waitUntil(
      new Promise((resolve) => {
        notifResolve = resolve
        notifTimer = setTimeout(() => {
          notifTimer = null
          notifResolve = null
          self.registration.showNotification(title, {
            body,
            icon: '/icons/icon-192.png',
            tag: 'workout-timer',
            renotify: true,
            silent: false,
          }).then(resolve).catch(resolve)
        }, delay)
      })
    )
  }
})

// Tapping the notification brings the app to the foreground
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ('focus' in c) return c.focus()
      if (clients.openWindow) return clients.openWindow('/')
    })
  )
})
