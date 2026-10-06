/**
 * Minimal pathname router (no library: three routes don't justify a dependency).
 *
 * Routes: `/` → home, `/b/:id` → board, anything else → not_found.
 * Uses History API: `navigate()` pushes state, `useRoute()` subscribes to popstate.
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parses a pathname into a Route. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match) {
    const id = decodeURIComponent(match[1] ?? '');
    return { name: 'board', id };
  }
  return { name: 'not_found' };
}

/** Pushes a new path onto the history stack. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Manually dispatch so useRoute picks it up (pushState doesn't fire popstate).
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** React hook: the current route, updated on navigation. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return route;
}
