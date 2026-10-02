import { useSyncExternalStore } from 'react';
import { BOARD_ID_PATTERN } from '../shared/board-id';

/**
 * Story 5: minimal client router on History API + popstate.
 * Routes: `/` (home), `/b/<22-char id>` (board), anything else (not found).
 */
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  if (match && BOARD_ID_PATTERN.test(match[1])) {
    return { name: 'board', id: match[1] };
  }
  return { name: 'not_found' };
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

let cachedPathname: string | null = null;
let cachedRoute: Route = { name: 'not_found' };

function getRoute(): Route {
  const pathname = window.location.pathname;
  if (pathname !== cachedPathname) {
    cachedPathname = pathname;
    cachedRoute = parseRoute(pathname);
  }
  return cachedRoute;
}

/** Current route, re-renders on pushState/replaceState/popstate. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

/**
 * Client-side navigation (pushState). Notifies router subscribers so
 * `useRoute` consumers re-render without a page reload.
 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  for (const listener of [...listeners]) listener();
}
