/**
 * Which page an address is.
 *
 * This is the whole router: a path comes in, one of four things comes out, and the address bar
 * is kept in step by `navigate` and `replace` rather than by anybody writing to `location`
 * directly. A real page change (`history.back()`, a link the browser followed) is picked up
 * from `popstate`; our own navigations are announced with an event of our own, because
 * `pushState` does not fire one and the screen has to change when the address does.
 *
 * There is no route table, no parameters object, no nesting and no lazy loading. Three
 * addresses mean anything: the home page, a board, and whatever else a person ends up at —
 * which is the Board not found page, the same one a bad link gets, because "we have no page
 * called that" and "we have no board called that" are the same answer to the person standing
 * there (`share.not_found`).
 */

import { useCallback, useEffect, useState } from 'react';

import { isValidBoardId } from '../shared/board-id';

/** Boards live under this path: `/b/<board id>`. */
export const BOARD_PATH_PREFIX = '/b/';

/** The one page that is not the home page and not a board. */
export const HOME_PATH = '/';

/** The address of a board — the thing a link is made out of. */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

/** Which page an address asks for. */
export type Route =
  /** The home page: what vidi6 is, and the way to a new board. */
  | { kind: 'home' }
  /** A board whose link is at least shaped like one. Whether it exists is a question for the service. */
  | { kind: 'board'; boardId: string }
  /**
   * Nothing to open here: an address that looks like a board and is not one (a truncated link,
   * a mistyped character), or an address that is not any of ours. `boardId` is what the person
   * asked for, when it looked like one — the page shows it, so a truncated link can be compared
   * with the one that was sent.
   */
  | { kind: 'notFound'; boardId: string | null };

/**
 * Reads a page out of a path.
 *
 * A query string is not part of the board id (`/b/<id>?utm=chat` is that board: a link that
 * survives being pasted through a chat application is the whole point of the alphabet). Beyond
 * that there is nothing to be flexible about: `/b/<id>` is a board and every other shape is a
 * link we do not have — including `/b/<id>/anything`, which is not a page this product has.
 */
export function routeFor(pathname: string): Route {
  const path = pathname.split('?')[0] ?? '';
  if (path === HOME_PATH || path === '') return { kind: 'home' };
  if (!path.startsWith(BOARD_PATH_PREFIX)) return { kind: 'notFound', boardId: null };
  const asked = path.slice(BOARD_PATH_PREFIX.length);
  if (asked === '') return { kind: 'notFound', boardId: null };
  const boardId = decodeSegment(asked);
  return boardId !== null && isValidBoardId(boardId)
    ? { kind: 'board', boardId }
    : { kind: 'notFound', boardId: asked };
}

/**
 * A link as a person typed it, percent-decoded — or null when it is not an encoding anybody's
 * browser would accept, which is an address we do not know rather than a crash.
 */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The event our own navigations fire, because `pushState` fires nothing. */
const NAVIGATED = 'vidi6:navigated';

/** Puts a path in the address bar and tells whoever is listening. */
function go(path: string, method: 'pushState' | 'replaceState'): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== path) window.history[method]({}, '', path);
  window.dispatchEvent(new Event(NAVIGATED));
}

/** Goes to a page, and leaves the one you were on behind in the back button. */
export function navigate(path: string): void {
  go(path, 'pushState');
}

/** Goes to a page without adding it to the back button. */
export function replace(path: string): void {
  go(path, 'replaceState');
}

/** The path on screen now. */
function currentPath(): string {
  return typeof window === 'undefined' ? HOME_PATH : window.location.pathname;
}

/**
 * The page this tab is on, kept up to date.
 *
 * The path is read once and then only ever replaced by another path, so a re-render cannot
 * change which page is on screen — only an address change can.
 */
export function useRoute(): Route {
  const [pathname, setPathname] = useState(currentPath);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (): void => setPathname(currentPath());
    window.addEventListener('popstate', onChange);
    window.addEventListener(NAVIGATED, onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(NAVIGATED, onChange);
    };
  }, []);

  return routeFor(pathname);
}

/** What `useNavigator` gives the pages. */
export interface PageNavigator {
  /** The page to show. */
  route: Route;
  /** Goes to a path, adding it to the back button. */
  go(path: string): void;
}

/**
 * The route, and the way to change it.
 *
 * A page is given the way out as well as the way in, so that a test can render one page at an
 * address and see where its button goes without any tab having to move.
 */
export function useNavigator(): PageNavigator {
  const route = useRoute();
  const go = useCallback((path: string) => navigate(path), []);
  return { route, go };
}
