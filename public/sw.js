'use strict';
// Service worker: shows push notifications and opens the agent they point at.
// No offline cache: the app is useless without the host anyway.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Herdr Hub', body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Herdr Hub', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

// An open app only changes its route (postMessage; the page sets location.hash), so drafts,
// the list position and everything else on the page survive. No window: open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      const w = wins.find((c) => 'focus' in c);
      if (!w) return self.clients.openWindow(url);
      // A page not controlled by this worker may be an older version without the listener.
      if (w.url && new URL(w.url).origin === self.location.origin && 'postMessage' in w) {
        w.postMessage({ type: 'open', url });
        return w.focus();
      }
      if ('navigate' in w) await w.navigate(url);
      return w.focus();
    })
  );
});
