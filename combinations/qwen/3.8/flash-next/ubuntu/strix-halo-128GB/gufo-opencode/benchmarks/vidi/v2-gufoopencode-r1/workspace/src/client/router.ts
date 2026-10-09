import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

// Three routes do not justify a router library: '/' is Home, '/b/<id>' is the
// board (the id itself is validated by BoardPage, so a mistyped link still
// reaches the page that explains it), and anything else is not found.
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/?#]+)$/.exec(pathname);
  if (match === null) return { name: 'not_found' };
  return { name: 'board', id: decodeURIComponent(match[1]) };
}

// pushState does not fire popstate, so navigate() raises its own event that
// useRoute() listens for alongside popstate (back/forward).
const NAVIGATE_EVENT = 'vidi6:navigate';

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const update = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return route;
}
