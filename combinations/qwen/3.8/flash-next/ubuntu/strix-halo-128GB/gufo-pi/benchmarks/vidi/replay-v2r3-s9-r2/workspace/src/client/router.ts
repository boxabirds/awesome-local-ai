import { useState, useEffect } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

function parsePathname(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch popstate so listeners react
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePathname(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parsePathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return route;
}
