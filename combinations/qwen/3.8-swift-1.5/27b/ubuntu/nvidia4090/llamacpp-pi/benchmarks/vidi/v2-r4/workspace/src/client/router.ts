import { useState, useEffect } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/') {
    return { name: 'home' };
  }
  const match = pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  if (match) {
    return { name: 'board', id: match[1] };
  }
  return { name: 'not_found' };
}

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

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Trigger a popstate-like update for the router
  window.dispatchEvent(new PopStateEvent('popstate'));
}
