// Minimal pathname router (spec: share.pages): `/` → home, `/b/:id` → board,
// anything else → not found. History API only — no router library.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = /^\/b\/([^/]+)$/.exec(pathname);
  if (match !== null && match[1] !== undefined) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

/** Current route, kept in sync with popstate (back/forward). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return route;
}

/**
 * Push a new pathname. `pushState` fires no popstate, so dispatch one —
 * listeners (useRoute) treat it exactly like a real navigation.
 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
