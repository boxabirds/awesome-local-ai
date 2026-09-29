// The URL is the entry point (design "Routing"): `/` is the home page, `/b/:id`
// is a board. No router library: `parseRoute` is a pure function of the pathname
// so the mapping is unit-testable (TC-16), and `App` just re-parses on popstate.
//
// A `/b/…` path whose id is not a valid board id resolves straight to `not-found`
// — there is nothing to look up, and the server is never asked (share.not_found).

import { isValidBoardId } from '../shared/board-id.ts';

export type Route =
  | { kind: 'home' }
  /** A syntactically valid id: the board has to be looked up before it opens. */
  | { kind: 'board'; boardId: string }
  /** The path names a board that cannot exist (malformed or unknown id). */
  | { kind: 'not-found'; boardId: string };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '' || pathname === '/index.html') {
    return { kind: 'home' };
  }
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (!match) return { kind: 'not-found', boardId: '' };
  const boardId = decodeURIComponent(match[1]);
  return isValidBoardId(boardId)
    ? { kind: 'board', boardId }
    : { kind: 'not-found', boardId };
}

/** The full link to a board, as it is copied to the clipboard (share.copy). */
export function boardUrl(boardId: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}/b/${boardId}`;
}

/** The path of a board, for in-app navigation. */
export function boardPath(boardId: string): string {
  return `/b/${boardId}`;
}

/**
 * In-app navigation. `history.pushState` alone does not fire `popstate`, and a
 * full `location.assign` would throw the page away (and does not exist under
 * jsdom), so the path is pushed and this app's own listeners are told — the one
 * thing `App` does when the route changes.
 */
export function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
