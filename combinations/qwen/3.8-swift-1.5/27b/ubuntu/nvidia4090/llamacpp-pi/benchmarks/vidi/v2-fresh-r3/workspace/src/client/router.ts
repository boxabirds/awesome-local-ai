import { useEffect, useState } from 'react';

/**
 * Minimal pathname router (no router library: three routes do not justify a
 * dependency). `/` → home, `/b/:id` → board (validity checked by BoardPage),
 * anything else → not found. Uses the History API.
 */
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parses a pathname into a Route. */
export function routeFromPathname(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const m = pathname.match(/^\/b\/(.+)$/);
  if (m) return { name: 'board', id: m[1] };
  return { name: 'not_found' };
}

function currentRoute(): Route {
  return routeFromPathname(window.location.pathname);
}

/** Subscribes to the current route (initial value + popstate). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** Navigates to `path` via history.pushState and notifies route listeners. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
