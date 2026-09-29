/**
 * Story 5: minimal pathname router (no router library — three routes do not
 * justify a dependency).
 *
 *   /          → home (Create a board)
 *   /b/:id     → board (existence check → board / not found / unreachable)
 *   anything   → not found
 *
 * Navigation is the History API (`pushState`) plus a synthetic `popstate`
 * so `useRoute` re-renders; real back/forward pops re-parse the pathname.
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parses a pathname into a Route. Exported for tests. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const m = /^\/b\/([^/]+)$/.exec(pathname);
  if (m) return { name: 'board', id: m[1] };
  return { name: 'not_found' };
}

/** The current route, kept in sync with `popstate` (back/forward). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname),
  );
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return route;
}

/** Navigates within the SPA (no full page load). */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
