/* Mobile POS Express - service worker
   - Pages: network first (so a new index.html shows up on the first online open), cache as fallback.
   - Tailwind, Font Awesome and Google Fonts: cached on the first online visit, then served instantly.
   Bump CACHE only if you want to force-clear old cached files. */
const CACHE = 'pos-cache-v1';
const HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const PRELOAD = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(precache());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function precache() {
  const c = await caches.open(CACHE);
  // the app page itself
  await Promise.allSettled([self.registration.scope, './index.html'].map(async u => {
    const r = await fetch(u, { cache: 'no-store' });
    if (r.ok) await c.put(u, r);
  }));
  // libraries + the font files their CSS points to
  for (const u of PRELOAD) {
    try {
      const isCss = /\.css$|\/css2\?/.test(u);
      const r = await fetch(u, { mode: isCss ? 'cors' : 'no-cors' });
      await c.put(u, r.clone());
      if (isCss && r.ok) {
        const css = await r.text();
        const files = [...css.matchAll(/url\(([^)]+)\)/g)]
          .map(m => new URL(m[1].replace(/['"]/g, ''), u).href)
          .filter(f => /\.woff2(\?|$)/.test(f));
        await Promise.allSettled([...new Set(files)].map(async f => {
          const fr = await fetch(f, { mode: 'cors' });
          if (fr.ok) await c.put(f, fr);
        }));
      }
    } catch (err) { /* offline during install: runtime caching will catch up */ }
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { e.respondWith(page(req, url)); return; }
  if (HOSTS.includes(url.hostname)) e.respondWith(library(req));
  // everything else (the Google Apps Script API, etc.) goes straight to the network
});

function withTimeout(p, ms) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
}

async function page(req, url) {
  const c = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  try {
    const r = await withTimeout(fetch(url.href, { cache: 'no-store' }), 4000);
    if (r && r.ok) { c.put(key, r.clone()); return r; }
  } catch (err) { /* offline or slow: fall back to the cached copy */ }
  const hit = (await c.match(key)) || (await c.match(self.registration.scope)) || (await c.match('./index.html'));
  return hit || new Response('Offline, and the app has not been saved on this device yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

async function library(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreVary: true });
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}