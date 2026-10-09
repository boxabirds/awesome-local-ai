import { useSyncExternalStore } from 'react';

/**
 * The whole router (story 5): `/` is home, `/b/:id` is a board, everything else is the
 * Board not found page. There is no router library, because there is nothing to
 * configure — three addresses and a `history.pushState` call.
 */

export const HOME_PATH = '/';
const BOARD_PATH_PREFIX = '/b/';

/**
 * Story 3 wrote board addresses into the hash (`#/b/<id>`) before `POST /api/boards`
 * existed. They still name a board, so they still open one: a link sent around before
 * this story shipped is not broken by it.
 */
const LEGACY_BOARD_IN_HASH = /^#\/b\/([^/]+)$/;

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'board'; readonly id: string }
  | { readonly name: 'not_found' };

/** Where a board lives. Every link the app hands out is this and nothing else. */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

/** The full link to a board — what the Share panel copies, and what `parseRoute` reads back. */
export function boardLink(origin: string, boardId: string): string {
  return `${origin}${boardPath(boardId)}`;
}

/**
 * Which page an address is.
 *
 * An id that is badly formed is *not* filtered here: `/b/bad` is a board address, and
 * `BoardPage` decides it is not a board (story 5: the not-found decision, and the fact
 * that no request is sent, belong to the page). Filtering here would also make the
 * router disagree with `/api/boards/:id`, which answers 404 for the same address.
 */
export function parseRoute(pathname: string, hash = ''): Route {
  if (pathname === HOME_PATH) {
    const legacy = LEGACY_BOARD_IN_HASH.exec(hash);
    return legacy?.[1] !== undefined ? { name: 'board', id: legacy[1] } : { name: 'home' };
  }
  if (pathname.startsWith(BOARD_PATH_PREFIX)) {
    const id = decodeTail(pathname.slice(BOARD_PATH_PREFIX.length));
    // `/b/` with nothing after it is not a board, and neither is `/b/a/b`.
    if (id !== '' && !id.includes('/')) return { name: 'board', id };
  }
  return { name: 'not_found' };
}

/** A percent-encoded address is decoded for display purposes only; failures are not fatal. */
function decodeTail(tail: string): string {
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/* ------------------------------------------------------------------------- *
 * The current route, as a store: `pushState` fires no event, so `navigate` says
 * so itself, and the browser's back and forward buttons arrive as `popstate`.
 * ------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', notify);
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}

// `useSyncExternalStore` compares snapshots with `Object.is`, so the same address has to
// hand back the same object — a fresh one per call would re-render the app forever.
let cachedPathname = '';
let cachedHash = '';
let cachedRoute: Route = { name: 'home' };

function currentRoute(): Route {
  const { pathname, hash } = window.location;
  if (pathname !== cachedPathname || hash !== cachedHash) {
    cachedPathname = pathname;
    cachedHash = hash;
    cachedRoute = parseRoute(pathname, hash);
  }
  return cachedRoute;
}

/**
 * Go somewhere without reloading the page. The app is a single document, and a board is
 * a different board only because its address is different — a `location.assign` would
 * throw the Yjs document away, which stories 2–4 spent three stories not doing.
 */
export function navigate(path: string): void {
  if (window.location.pathname === path && window.location.hash === '') {
    // Same address, same board: nothing to tell anybody.
    return;
  }
  window.history.pushState(null, '', path);
  notify();
}

/** The route this page is on, updated when the user presses back or forward. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, currentRoute);
}
