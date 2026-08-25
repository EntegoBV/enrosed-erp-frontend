/*
 * Service worker for Enrosed push notifications.
 *
 * The backend sends {kind, title, body, url}. Beyond showing the native
 * notification, every open app window gets a message with the kind: a new
 * sale makes the app play the cash register even while you are working in it.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* plain text */ }
  const title = data.title || 'Enrosed';
  const body = data.body || '';
  const kind = data.kind || 'info';
  const url = data.url || '/';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ source: 'enrosed-push', kind, title, body });
    }
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: kind + ':' + body.slice(0, 40),
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
