// Minimal pathname router using History API.
// Routes: `/` → home, `/b/:id` → board, anything else → not_found.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/]+)$/.exec(pathname);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return route;
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch popstate so the router picks up the change.
  window.dispatchEvent(new PopStateEvent('popstate'));
}
