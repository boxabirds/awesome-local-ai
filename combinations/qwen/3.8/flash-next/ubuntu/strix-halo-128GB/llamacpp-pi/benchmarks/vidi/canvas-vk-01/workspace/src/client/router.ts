import { useState, useEffect } from 'react';

/**
 * Minimal pathname router: `/` home, `/b/:id` board, anything else not found.
 * No external library; three routes do not justify a dependency.
 */

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parse a pathname into a Route. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/?#]+)/.exec(pathname);
  if (match !== null) {
    return { name: 'board', id: decodeURIComponent(match[1]!) };
  }
  return { name: 'not_found' };
}

/** Navigate to a new path using the History API. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch popstate so listeners (useRoute) update.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Subscribe to the current route; re-renders on popstate. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return route;
}
