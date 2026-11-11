/*
 * Service worker for Enrosed push notifications.
 *
 * The backend sends {kind, title, body, url, tag?}. Beyond showing the native
 * notification, every open app window gets a message with the kind: a new
 * sale makes the app play the cash register even while you are working in it.
 *
 * A new version takes over at once: it keeps no caches and handles no fetch,
 * and an open window reloads itself for a newer build (fresh-build-service.ts)
 * instead of being closed, so a waiting worker would wait for good and the
 * page would keep getting the old worker's messages.
 */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* plain text */ }
  const title = data.title || 'Enrosed';
  const body = data.body || '';
  const kind = data.kind || 'info';
  const url = data.url || '/';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appVisible = clients.some((client) => client.visibilityState === 'visible');
    // url and tag travel along: a visible window whose sound the browser refuses shows the banner itself (push.ts ring).
    for (const client of clients) {
      client.postMessage({ source: 'enrosed-push', kind, title, body, appVisible, url, tag: typeof data.tag === 'string' ? data.tag : '' });
    }
    /* With the app in front, the in-app sound and toast carry the news;
       a system banner on top would ring twice and say it twice. */
    if (appVisible) return;
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // A stable notice id replaces a retried delivery instead of stacking
      // another system banner. Older senders retain their existing grouping.
      tag: typeof data.tag === 'string' && data.tag.trim() ? data.tag : kind + ':' + (kind === 'contact-inquiry' || kind === 'login-request' ? url : body.slice(0, 40)),
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
