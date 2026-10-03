/**
 * The three routes this app has, with no router library.
 *
 * `/` is the home page, `/b/<boardId>` is a board, and everything else is the not-found
 * page. That is the whole product surface, so the "router" is a pathname parser plus the
 * History API: `navigate()` pushes and tells the subscribers, because `pushState` does
 * not fire `popstate` itself and a page that pushed a path would otherwise sit there
 * showing the page it left.
 *
 * A malformed board id is *not* resolved here: `/b/anything` is a board route, and
 * `BoardPage` decides what to do with an id that cannot name a board. Saying "that
 * address is not a board" needs the same rule the Worker applies (`isValidBoardId`), and
 * putting it in one place keeps the page and the room from disagreeing.
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The address of a board. One place builds it, so a shared link and a route cannot drift. */
export function boardPath(boardId: string): string {
  return `/b/${boardId}`;
}

/** The route a pathname asks for. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/]*)\/?$/.exec(pathname);
  if (match?.[1] !== undefined) {
    let id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // A path that cannot be decoded names nothing, which is the not-found page.
      return { name: 'not_found' };
    }
    return { name: 'board', id };
  }
  return { name: 'not_found' };
}

/**
 * Go to `path` without reloading the page.
 *
 * `replace` is for the cases where the address you are leaving should not come back:
 * creating a board, where "back" would be a home page that creates another one.
 */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  // Whoever is listening re-reads the address. An event rather than a shared store,
  // because the address bar is the store and it also changes on Back and Forward.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Whether two routes are the same page. Routes are plain data, so this is a comparison. */
function sameRoute(left: Route, right: Route): boolean {
  if (left.name !== right.name) return false;
  return left.name === 'board' && right.name === 'board' ? left.id === right.id : true;
}

/** The route the browser is on, kept up to date with Back and Forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPopState = () =>
      setRoute((current) => {
        const next = parseRoute(window.location.pathname);
        // The same page stays the same page: a board re-rendered because the address did
        // not move would rebuild its document for nothing.
        return sameRoute(current, next) ? current : next;
      });
    // Pick up anything that moved between the render and this subscription.
    onPopState();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return route;
}
