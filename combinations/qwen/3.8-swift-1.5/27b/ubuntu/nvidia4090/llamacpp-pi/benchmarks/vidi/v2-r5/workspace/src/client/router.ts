// src/client/router.ts
// Minimal pathname router using History API. No router library.

import { useState, useEffect, useCallback } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parsePathname(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePathname(window.location.pathname));

  const update = useCallback(() => {
    setRoute(parsePathname(window.location.pathname));
  }, []);

  useEffect(() => {
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [update]);

  return route;
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Trigger a popstate-like update by dispatching a custom event
  // that useRoute listens to via popstate
  window.dispatchEvent(new PopStateEvent('popstate'));
}
