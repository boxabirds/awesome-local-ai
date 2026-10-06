/**
 * The router (design "Home, board and not-found pages").
 *
 * Three routes, so there is no router library: `/` is the home page, `/b/<boardId>` is
 * a board, and everything else on this origin is a page that says Board not found. The
 * address bar is the router's state — a board is a place you go to, and the link to it
 * is the thing people share — and this file is the only place that reads it.
 *
 * A path is turned into a route *without* asking a server anything: `/b/abc` is not a
 * board and never was, and the difference between "that is not an address" and "there
 * is nothing at that address" is not worth a request, or a second page (TC-19).
 */

import { useSyncExternalStore } from 'react';

import { isValidBoardId } from '../shared/board-id.js';

/** The home page. */
export const HOME_PATH = '/';

/** The prefix every board address starts with. */
export const BOARD_PATH_PREFIX = '/b/';

/** One of the three things this app can be showing. */
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The board this path names, or null when it names none. */
export function boardIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith(BOARD_PATH_PREFIX)) return null;
  const candidate = pathname.slice(BOARD_PATH_PREFIX.length).replace(/\/+$/u, '');
  return isValidBoardId(candidate) ? candidate : null;
}

/** The path a board lives at (design "connection-status": `/b/<boardId>`). */
export const boardPath = (boardId: string): string => `${BOARD_PATH_PREFIX}${boardId}`;

/** What this path is. Pure, so a test can ask it about a path it made up. */
export function routeOf(pathname: string): Route {
  if (pathname === HOME_PATH) return { name: 'home' };
  const id = boardIdFromPathname(pathname);
  if (id !== null) return { name: 'board', id };
  // One page for every address that is not a board: whether the link is malformed, empty,
  // or a board-shaped string that was never made, the thing the person needs is the same
  // and telling them which kind of broken they have would be telling them something we
  // do not know.
  return { name: 'not_found' };
}

/* ------------------------------------------------------------------ the address bar */

/**
 * Subscribers of `navigate`. A `history.pushState` does not fire `popstate`, so a
 * route change made by this app has to be announced by this module; the listener set
 * is the announcement. `popstate` (the browser's own Back and Forward) is handled at
 * the window, which is why there is only one of these two to keep.
 */
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('popstate', emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('popstate', emit);
    }
  };
};

const pathname = (): string => (typeof window === 'undefined' ? HOME_PATH : window.location.pathname);

/** The route this window is at, kept up to date across Back and Forward. */
export function useRoute(): Route {
  return routeOf(useSyncExternalStore(subscribe, pathname, () => HOME_PATH));
}

/**
 * Go to a path, and put it in the address bar.
 *
 * `pushState`, not `replaceState`: a board a person came to by clicking is a place
 * they can go back from, and Back returning them to the home page — rather than
 * leaving the site — is what makes this app's history behave like the rest of the web.
 */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === path) {
    emit();
    return;
  }
  window.history.pushState(null, '', path);
  emit();
}
