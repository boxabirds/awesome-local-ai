// The route the app is on, as React state, and the only way the app changes it.
//
// A route change is a History-API navigation - `pushState` plus a notification -
// so the address bar shows the board's own address, the back button returns to
// where the visitor came from, and the link in the Share panel is the address of
// the board it opens. A page reload would do the same thing less gracefully; what
// matters is that the address is the real one and not an illusion kept in state.
import { useEffect, useState } from 'react';
import { parseRoute, type Route } from './router.ts';

/** Fired after the address changes without a user gesture. */
export const NAVIGATE_EVENT = 'vidi6:navigate';

/** Go to a path, and tell this app about it. */
export function navigateTo(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/**
 * The current route, kept current across the back button and forward button
 * (`popstate`) as well as the app's own navigations.
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  useEffect(() => {
    const read = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', read);
    window.addEventListener(NAVIGATE_EVENT, read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener(NAVIGATE_EVENT, read);
    };
  }, []);
  return route;
}

/** How a route is keyed: the board page is a different thing per code. */
export function routeKey(route: Route): string {
  switch (route.kind) {
    case 'home':
      return 'home';
    case 'board':
      return `board:${route.boardId}`;
    case 'not_found':
      return `not_found:${route.boardId ?? ''}`;
  }
}
