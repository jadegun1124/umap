// Umap PWA. Same-origin GET is network first. Family sync is cross-origin and must not be intercepted:
// a service worker that forwards PUT bodies can drop the live location publish.
const CACHE_NAME = 'umap-pwa-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (url.pathname.includes('/v1/')) return;
  if (url.hostname.includes('vworld.kr') || event.request.destination === 'image') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Umap';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const alert = {
    id: payload.id,
    kind: payload.kind,
    code: payload.code,
    at: payload.at,
    from: payload.from,
    to: payload.to,
    body,
  };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = windows.some((client) => client.visibilityState === 'visible');
    if (payload.kind === 'chat') {
      const text = typeof payload.text === 'string' && payload.text ? payload.text : body;
      await Promise.all(windows.map((client) => client.postMessage({
        type: 'umap-chat',
        code: payload.code,
        message: {
          id: payload.id,
          from: payload.from,
          to: payload.to,
          text,
          at: payload.at,
        },
      })));
      if (visible) return;
      await self.registration.showNotification(title, {
        body,
        tag: `umap-chat-${payload.code || ''}-${payload.from || ''}`,
        renotify: true,
        data: alert,
      });
      return;
    }
    if (visible) {
      await Promise.all(windows.map((client) => client.postMessage({ type: 'umap-alert', alert })));
      return;
    }
    const shadeBody = body && body !== title ? body : '';
    await self.registration.showNotification(title, {
      body: shadeBody,
      tag: typeof payload.id === 'string' ? payload.id : 'umap-alert',
      renotify: true,
      data: alert,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL('./?app=1', self.location.href);
  if (data.kind === 'chat' && data.code && data.from) {
    target.searchParams.set('room', String(data.code));
    target.searchParams.set('chat', String(data.from));
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if (data.kind === 'chat' && data.code && data.from) {
          client.postMessage({ type: 'umap-open-chat', code: data.code, peer: data.from });
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target.href);
  })());
});
