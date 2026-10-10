// Story 5: a three-route pathname router (`/`, `/b/:id`, everything else
// not found) on top of the History API. No router library.

import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

export function routeFromPath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/]+)$/.exec(pathname);
  if (match !== null) return { name: 'board', id: decodeURIComponent(match[1]) };
  return { name: 'not_found' };
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // pushState does not fire popstate; dispatch it so useRoute subscribers
  // update without a full reload.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  useEffect(() => {
    const update = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return route;
}
