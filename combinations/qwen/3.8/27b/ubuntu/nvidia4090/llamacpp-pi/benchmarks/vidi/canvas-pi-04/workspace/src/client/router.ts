// Story 5: tiny client router (share.pages). No router library: the route
// is parsed from location.pathname, navigation is history.pushState, and
// back/forward re-parses via popstate.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Parse a pathname: `/` is home, `/b/<id>` is a board, anything else not_found. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match !== null) {
    // The id is validated by BoardPage (an invalid id renders the
    // not-found page WITHOUT a request — share.pages).
    return { name: 'board', id: match[1]! };
  }
  return { name: 'not_found' };
}

/** The current route; re-parsed on back/forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/**
 * Navigate to a new pathname (pushState). pushState does not fire popstate,
 * so a synthetic popstate is dispatched to refresh any mounted useRoute().
 */
export function navigate(pathname: string): void {
  window.history.pushState(null, '', pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
