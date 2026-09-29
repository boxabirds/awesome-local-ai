/**
 * Minimal pathname router: `/` → home, `/b/:id` → board, anything else → not found.
 * Uses History API (pushState + popstate). No router library.
 */
import { useState, useEffect } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) {
    return { name: 'board', id: match[1] };
  }
  return { name: 'not_found' };
}

/**
 * Board id encoded in the current path (`/b/:id`), if any. Used by components
 * that need to call the board API but are rendered by the generic object
 * registry and therefore receive no board identity of their own.
 */
export function boardIdFromPath(pathname: string = window.location.pathname): string | undefined {
  const match = pathname.match(/^\/b\/([A-Za-z0-9_-]+)/);
  return match?.[1];
}

/**
 * Hook that returns the current route and re-renders on navigation.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}

/**
 * Navigate to a new path using pushState.
 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch popstate so useRoute picks it up
  window.dispatchEvent(new PopStateEvent('popstate'));
}
