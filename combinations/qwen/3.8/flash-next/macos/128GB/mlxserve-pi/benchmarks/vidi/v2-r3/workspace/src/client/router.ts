// The whole of the client's routing (share.pages). Three routes do not justify a
// router library: the Home page, a board at `/b/<id>`, and everything else. This
// reads `location.pathname` and re-renders on the browser's `popstate` (Back /
// Forward); `navigate` uses the History API, which is what the design names.
//
// The path shapes are exactly those in `shared/routes`: `/` is home, `/b/<id>` is
// a board, and the board id there is validated before it is handed to a page — an
// id that is not a well-formed board address is `not_found`, so the client never
// sends a request for a malformed address (share.not_found, TC-19).
import { useEffect, useState } from 'react';
import { isValidBoardId } from '../shared/board-id';
import { BOARD_PATH_PREFIX } from '../shared/routes';

/** Which page the current address names. */
export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

/** The route for a pathname. Pure, so a test can drive every branch. */
export function routeFor(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname.startsWith(BOARD_PATH_PREFIX)) {
    const id = pathname.slice(BOARD_PATH_PREFIX.length);
    // The id is the whole path after `/b/`: anything after it, or anything that
    // is not a well-formed board address, names no board.
    if (isValidBoardId(id)) return { name: 'board', id };
  }
  return { name: 'not_found' };
}

/** The current route, kept in step with Back / Forward. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFor(window.location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(routeFor(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/**
 * Go to a path without a full page load. The Home page calls this after creating
 * a board, so the new board's address is the one in the bar (share.create).
 */
export function navigate(path: string): void {
  if (window.location.pathname === path) {
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
