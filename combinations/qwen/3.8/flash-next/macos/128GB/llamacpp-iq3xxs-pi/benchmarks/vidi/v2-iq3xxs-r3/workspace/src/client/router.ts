/**
 * The two places this app is (share.locations).
 *
 * A board's address is the address of a board that exists, so the client stops
 * inventing addresses: the server hands one out (`POST /api/boards`) and the
 * client only ever *reads* an address out of the location bar. Anything that is
 * not one of the two routes below is not found, and is answered locally — no
 * request, and no board opened by typing an id into the address bar.
 *
 * This is the only file that parses the path. Pages say what they are; they never
 * ask what the URL is, so the two page styles cannot drift into a state where one
 * of them silently decides a link is valid.
 */
import { useEffect, useState } from 'react';

import { isValidBoardId } from '../shared/board-id';

/** Where a board lives: `/b/<boardId>`. */
export const BOARD_PATH_PREFIX = '/b/';

/** The three things a path can be. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'board'; readonly boardId: string }
  | { readonly kind: 'notFound'; readonly path: string };

/** The address of a board, as a path. The only place one is written. */
export function boardHref(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

/**
 * A path, as it arrives from a link somebody pasted. `location.pathname` and
 * anything else a browser will accept is a string, and this stays total: a path
 * that is not a route is a path that is not found.
 */
export function routeFor(path: string): Route {
  if (path === '/' || path === '') return { kind: 'home' };
  if (path.startsWith(BOARD_PATH_PREFIX)) {
    const boardId = path.slice(BOARD_PATH_PREFIX.length);
    // A malformed id is not a board with a strange name; it is a page with no
    // board on it, and nothing else is asked about it (TC-19).
    if (isValidBoardId(boardId)) return { kind: 'board', boardId };
  }
  return { kind: 'notFound', path };
}

/** The path the browser is on right now. */
export function currentPath(): string {
  return window.location.pathname;
}

/**
 * Change the path without a reload. `replace` is for the cases where the current
 * path is not worth a history entry — a redirect from a board that turned out
 * not to exist, say.
 */
export function navigate(path: string, opts: { readonly replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  // pushState does not fire popstate, and the app is subscribed to the route
  // rather than to the location bar, so the change is announced here.
  emit();
}

/** What the back button does, which is not our business to intercept. */
window.addEventListener('popstate', emit);

const subscribers = new Set<() => void>();

function emit(): void {
  for (const notify of subscribers) notify();
}

/** The route the browser is on, kept up to date. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFor(currentPath()));

  useEffect(() => {
    const notify = (): void => setRoute(routeFor(currentPath()));
    subscribers.add(notify);
    // A path that changed between the first render and the subscription is not
    // missed: re-read it.
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return route;
}
