/**
 * Minimal pathname router using the History API.
 * Routes: `/` → home, `/b/:id` → board, anything else → not_found.
 */
import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/**
 * Parse a pathname into a Route.
 */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

/**
 * Navigate to a new path using pushState and trigger a re-render.
 */
let navigateListeners: Array<() => void> = [];

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Notify all active useRoute hooks
  for (const listener of navigateListeners) listener();
}

/**
 * React hook that returns the current route and re-renders on navigation.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  const update = useCallback(() => {
    setRoute(parseRoute(window.location.pathname));
  }, []);

  useEffect(() => {
    navigateListeners.push(update);
    window.addEventListener('popstate', update);
    return () => {
      navigateListeners = navigateListeners.filter((l) => l !== update);
      window.removeEventListener('popstate', update);
    };
  }, [update]);

  return route;
}
