import { useEffect, useState } from 'react';

// Three routes do not justify a router library: '/' (home), '/b/:id' (a
// board) and everything else (not found). Uses the History API so links open
// without a reload and the back button works.
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/?#]+)/.exec(pathname);
  if (match !== null) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { name: 'home' } : parseRoute(window.location.pathname)
  );
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}
