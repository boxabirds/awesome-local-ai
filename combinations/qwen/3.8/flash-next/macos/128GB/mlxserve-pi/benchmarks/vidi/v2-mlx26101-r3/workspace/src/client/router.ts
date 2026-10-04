import { useSyncExternalStore } from 'react';
import { isValidBoardId } from '../shared/board-id';

/**
 * The address bar, read as one of three things.
 *
 * The board's id is carried in the address (`/b/<id>`) and nowhere else: no list of boards, no
 * cookie, nothing remembered about this tab. That is what makes a link the whole of sharing - and
 * it means the address is the one part of the app that comes from outside, so it is read in one
 * place, carefully, and everything downstream is told which of the three it is.
 *
 * `/b/garbage` is `not-found` here, before any request: a code the generator would never produce
 * is not a board that might be hidden, it is a code, and asking about it would tell the person
 * nothing that this line does not already know.
 */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'board'; readonly boardId: string }
  | { readonly kind: 'not-found' };

/** The address of a board, as a path. */
export function boardPath(boardId: string): string {
  return `/b/${encodeURIComponent(boardId)}`;
}

/** The home page. */
export const HOME_PATH = '/';

/** The address shape a board has, exported so that the writer and the reader of an address can be checked against each other. */
export const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/** Read a path as a route. Pure: the tests hand it strings, and the browser hands it the same. */
export function routeOf(pathname: string): Route {
  if (pathname === '/' || pathname === '' || pathname === '/index.html') {
    return { kind: 'home' };
  }
  const encoded = BOARD_PATH.exec(pathname)?.[1];
  if (encoded === undefined) {
    return { kind: 'not-found' };
  }
  let boardId = encoded;
  try {
    boardId = decodeURIComponent(encoded);
  } catch {
    // `%` used for something other than an escape: this is not a board's code, and it is not a
    // crash either.
    return { kind: 'not-found' };
  }
  return isValidBoardId(boardId) ? { kind: 'board', boardId } : { kind: 'not-found' };
}

/**
 * The event `navigateTo` puts on the window.
 *
 * `history.pushState` does not fire anything, and a page that only listened for `popstate` would
 * keep showing the board you left while the address bar said otherwise - until you pressed back,
 * which would look like a different bug.
 */
const NAVIGATED = 'vidi6:navigate';

/**
 * Go to `path` without reloading the page.
 *
 * Reloading would be simpler and would work; it would also throw away the room this tab is in,
 * which is exactly what the home page must not do on its way to a board a second person is
 * already waiting on.
 */
export function navigateTo(path: string): void {
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATED, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATED, onChange);
  };
}

function snapshot(): string {
  return window.location.pathname;
}

/**
 * The address bar as a route, and a component that re-renders when it changes.
 *
 * `useSyncExternalStore` with the pathname as its snapshot: the route object itself would be a
 * new object on every render, which is the one thing this hook cannot be - the board underneath
 * it holds a document and a live connection, and a render loop would take both away.
 */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, snapshot, snapshot);
  return routeOf(pathname);
}
