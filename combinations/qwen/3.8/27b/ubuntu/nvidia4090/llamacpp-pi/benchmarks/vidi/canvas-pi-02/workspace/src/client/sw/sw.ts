/**
 * Service worker for the offline app shell (story 13).
 *
 * Pure functions are exported for unit testing; the service worker
 * registration logic uses them in the actual SW context.
 */
import { APP_SHELL_CACHE_PREFIX } from '../../shared/config';

export type RequestKind = 'shell' | 'asset' | 'passthrough';

/**
 * Classify a request to determine how the service worker handles it.
 * - shell: navigation requests to board or app routes (GET, mode=navigate)
 * - asset: GET requests to hashed assets (/assets/...)
 * - passthrough: everything else (API, WebSocket, non-GET, /sw.js)
 */
export function classifyRequest(req: { mode: string; url: string; method: string }): RequestKind {
  const url = new URL(req.url);

  // Never intercept the service worker itself.
  if (url.pathname === '/sw.js') return 'passthrough';

  // Never intercept API routes.
  if (url.pathname.startsWith('/api/')) return 'passthrough';

  // Only GET requests are cached.
  if (req.method !== 'GET') return 'passthrough';

  // WebSocket upgrades are passthrough.
  if (req.mode === 'websocket') return 'passthrough';

  // Hashed assets (JS, CSS, fonts) are cache-first.
  if (url.pathname.startsWith('/assets/')) return 'asset';

  // Navigation requests (mode=navigate) get the shell treatment.
  if (req.mode === 'navigate') return 'shell';

  return 'passthrough';
}

/**
 * Determine which existing caches to delete when a new release activates.
 * Keeps the current release's cache and any foreign caches; deletes only
 * old app-shell caches.
 */
export function cachesToDelete(existing: string[], currentRelease: string): string[] {
  const currentCache = APP_SHELL_CACHE_PREFIX + currentRelease;
  return existing.filter(
    (name) => name.startsWith(APP_SHELL_CACHE_PREFIX) && name !== currentCache,
  );
}
