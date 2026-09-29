import { useState, useEffect } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match) return { name: 'board', id: decodeURIComponent(match[1]) };
  return { name: 'not_found' };
}

/**
 * Minimal pathname router using the History API.
 * Three routes: / (home), /b/:id (board), anything else → not_found.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return route;
}

/**
 * Navigate to a new path using history.pushState.
 */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  // Manually trigger route update since pushState doesn't fire popstate
  window.dispatchEvent(new PopStateEvent('popstate'));
}
