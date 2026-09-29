/**
 * Service worker entry point (story 13, offline.app_shell).
 *
 * Built to dist/sw.js by Vite. Precaches the app shell, intercepts
 * navigation and asset requests for offline support.
 */
/// <reference lib="webworker" />
import { classifyRequest, cachesToDelete } from './sw';
import { APP_SHELL_CACHE_PREFIX } from '../../shared/config';

const RELEASE = 'release';
const CACHE_NAME = APP_SHELL_CACHE_PREFIX + RELEASE;

self.addEventListener('install', (event: Event) => {
  const extendableEvent = event as unknown as { waitUntil(p: Promise<void>): void };
  extendableEvent.waitUntil((async () => {
    try {
      const manifestRes = await fetch('/sw-manifest.json', { cache: 'no-cache' });
      if (!manifestRes.ok) return;
      const manifest = await manifestRes.json() as { files: string[] };
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(manifest.files.map((url) => cache.add(url).catch(() => {})));
    } catch {
      // Precache failed — the shell will still be fetched on demand.
    }
  })());
});

self.addEventListener('activate', (event: Event) => {
  const extendableEvent = event as unknown as { waitUntil(p: Promise<void>): void };
  extendableEvent.waitUntil((async () => {
    const keys = await caches.keys();
    const toDelete = cachesToDelete(keys, RELEASE);
    await Promise.all(toDelete.map((name) => caches.delete(name)));
    (self as unknown as { clients: { claim(): Promise<void> } }).clients?.claim?.();
  })());
});

self.addEventListener('fetch', (event: Event) => {
  const fetchEvent = event as unknown as { request: Request; respondWith(p: Promise<Response>): void };
  const req = fetchEvent.request;
  if (req.method !== 'GET') return;

  const kind = classifyRequest(req);
  if (kind === 'passthrough') return;

  if (kind === 'asset') {
    fetchEvent.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  if (kind === 'shell') {
    fetchEvent.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        const index = await caches.match('/index.html');
        if (index) return index;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
  }
});
