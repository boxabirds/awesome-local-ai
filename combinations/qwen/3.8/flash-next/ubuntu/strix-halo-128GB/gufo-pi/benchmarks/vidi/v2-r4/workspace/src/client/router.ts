import { useState, useEffect, useCallback } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parse a pathname into a Route. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) {
    return { name: 'board', id: match[1] };
  }
  return { name: 'not_found' };
}

/** Navigate using the History API. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch a popstate so listeners react
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** React hook that tracks the current route. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  const onPopState = useCallback(() => {
    setRoute(parseRoute(window.location.pathname));
  }, []);

  useEffect(() => {
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [onPopState]);

  return route;
}
