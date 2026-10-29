// Offline worker – upload this file next to index.html (same folder).
// It saves a copy of the page so the app opens with no internet.
// When you upload a new version of the HTML, change CACHE to a new name (e.g. 'trip-tracker-v3').
const CACHE = 'trip-tracker-v4';
const NETWORK_TIMEOUT_MS = 4000; // on a weak connection, fall back to the saved copy after 4s

const pageKey = url => { const u = new URL(url); u.hash = ''; u.search = ''; return u.href; };

async function cachePage(url) {
  try {
    const res = await fetch(pageKey(url), { cache: 'reload' });
    if (res.ok) await (await caches.open(CACHE)).put(pageKey(url), res);
  } catch (_) { /* offline right now – will be cached on the next online visit */ }
}

async function anySavedPage(cache) {
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res && (res.headers.get('Content-Type') || '').includes('text/html')) return res;
  }
  return null;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Save the page that registered this worker
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map(w => cachePage(w.url)));
  })());
});

// The page also asks explicitly, in case it wasn't open during activation
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CACHE_PAGE' && event.data.url) {
    event.waitUntil(cachePage(event.data.url));
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = pageKey(req.url);
    try {
      // Online: get the latest version (and save it); give up after a few seconds
      const res = await Promise.race([
        fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }),   // always ask the server; a new upload shows on the next open
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
      ]);
      if (res.ok) await cache.put(key, res.clone());
      return res;
    } catch (_) {
      // Offline or too slow: use the saved copy
      return (await cache.match(key)) || (await anySavedPage(cache)) ||
        new Response('<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:24px">אין חיבור לאינטרנט. פתח את האפליקציה פעם אחת עם אינטרנט כדי לשמור אותה לשימוש אופליין.</body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
