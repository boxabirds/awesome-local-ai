import { useState, useEffect, useCallback } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parse the current pathname into a Route. */
function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return { name: 'board', id: match[1]! };
  return { name: 'not_found' };
}

/** Navigate to a new path using History API. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch popstate manually so useRoute picks up the change
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** React hook that returns the current route and updates on navigation. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  const handlePopState = useCallback(() => {
    setRoute(parseRoute(window.location.pathname));
  }, []);

  useEffect(() => {
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [handlePopState]);

  return route;
}
