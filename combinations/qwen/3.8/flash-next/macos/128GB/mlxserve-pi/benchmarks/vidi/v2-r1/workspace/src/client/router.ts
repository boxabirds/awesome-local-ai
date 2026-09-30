import { useEffect, useState } from 'react';

/**
 * A minimal pathname router. Three routes do not justify a dependency, so this
 * is the whole thing: `/` is home, `/b/<id>` is a board, anything else is not
 * found (design: router.ts). It uses the History API and follows `popstate`, so
 * the back button and hand-typed addresses work.
 *
 * It knows nothing about whether a board exists — it only names which page an
 * address asks for. Whether `/b/<id>` is a real board is `BoardPage`'s business.
 */

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The board address: a single `/b/<id>` segment and nothing after it. An id
 * with a slash in it is not this route, so it lands on not_found. */
const BOARD_PATH = /^\/b\/([^/?#]+)$/;

export function routeFromPathname(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match !== null) return { name: 'board', id: decodeURIComponent(match[1]) };
  return { name: 'not_found' };
}

/** Go to a path without a full reload. `pushState` does not fire `popstate`,
 * so the router is nudged by hand; every mounted `useRoute` then re-reads the
 * address bar. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The route for the current address, kept current across navigation. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    routeFromPathname(window.location.pathname),
  );

  useEffect(() => {
    const onChange = (): void =>
      setRoute(routeFromPathname(window.location.pathname));
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  return route;
}
