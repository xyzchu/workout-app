let notifTimer = null

self.addEventListener('message', (e) => {
  const { type, endsAt, title, body } = e.data || {}

  if (notifTimer !== null) { clearTimeout(notifTimer); notifTimer = null }

  if (type === 'SCHEDULE') {
    const delay = endsAt - Date.now()
    if (delay <= 0) return
    notifTimer = setTimeout(() => {
      notifTimer = null
      self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        tag: 'workout-timer',
        renotify: true,
        silent: false,
      })
    }, delay)
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
