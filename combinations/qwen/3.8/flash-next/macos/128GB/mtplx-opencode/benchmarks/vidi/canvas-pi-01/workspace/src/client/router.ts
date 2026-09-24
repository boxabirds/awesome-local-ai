import { useSyncExternalStore } from 'react';

/**
 * Story 5 · the client router (design "Home, board and not-found pages").
 *
 * Three routes do not justify a router library, so this is the smallest thing
 * that can be *subscribed* to: the address bar already holds the only fact the
 * app needs (which board), and History gives us both a way to write it and a
 * `popstate` signal when the browser changes it.
 *
 * Two rules worth stating because later stories will want to break them:
 *  - A `/b/<id>` segment is read as a board route **whatever the id looks
 *    like**. `BoardPage` is what decides whether the id is a real board; the
 *    router's job is only to say which page a path belongs to.
 *  - `navigate()` replaces the pending entry rather than pushing one for the
 *    home → board hop. A board opened from home is the same "visit", so Back
 *    must not drop the visitor back onto a home page they have already left.
 */

/** Which page the current path belongs to. */
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The board routes live under this prefix. */
export const BOARD_PATH_PREFIX = '/b/';

/** The path of a board, for `navigate()` and for the Share panel. */
export function boardPath(id: string): string {
  return `${BOARD_PATH_PREFIX}${id}`;
}

/**
 * Read a route out of a pathname. Pure, so the component tests can pin it
 * without a DOM: a bare `/` is home, `/b/<anything>` is a board page (which may
 * itself decide the id is not a board), everything else is not found.
 */
export function routeFromPath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname.startsWith(BOARD_PATH_PREFIX)) {
    const rest = pathname.slice(BOARD_PATH_PREFIX.length).replace(/\/$/, '');
    if (rest.length > 0 && !rest.includes('/')) {
      return { name: 'board', id: decodeURIComponent(rest) };
    }
  }
  return { name: 'not_found' };
}

/** The address the app is currently showing (`/` outside a browser). */
export function currentPath(): string {
  return typeof window !== 'undefined' && window.location
    ? window.location.pathname
    : '/';
}

/** The route the app is currently showing. */
export function currentRoute(): Route {
  return routeFromPath(currentPath());
}

// ---- subscription ---------------------------------------------------------

/** One subscriber per component that is watching the address. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Replace the current history entry and tell subscribers. Used for the home →
 * board hop (see the file header).
 */
export function replace(path: string): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', path);
  notify();
}

/** Go to `path`, pushing a history entry, and tell subscribers. */
export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  window.history.pushState(null, '', path);
  notify();
}

/**
 * Subscribe to address changes (ours and the browser's Back / Forward). The
 * `popstate` handler is created per subscriber so that one component unmounting
 * cannot silence the others; the second argument of `addEventListener` is
 * therefore a fresh function, which is exactly what `removeEventListener` needs.
 */
export function subscribeRoute(listener: () => void): () => void {
  listeners.add(listener);
  const onPopState = () => listener();
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', onPopState);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', onPopState);
    }
  };
}

// ---- React binding --------------------------------------------------------

/**
 * The route hook the app renders from. `useSyncExternalStore` is the honest
 * primitive here: the address is state that lives outside React, it can change
 * without a render (Back / Forward), and reading it must never be a side
 * effect.
 *
 * The route is *cached per pathname*. `useSyncExternalStore` compares the value
 * it read, so a snapshot that rebuilds the object every call makes React see a
 * new state on every render and loop forever — the one way a three-route app can
 * hang itself. Equal path in, identical object out.
 */
const HOME: Route = { name: 'home' };
let cachedPath: string | null = null;
let cachedRoute: Route = HOME;

/** The route for the current address, memoised on the address itself. */
function routeSnapshot(): Route {
  const path = currentPath();
  if (path !== cachedPath) {
    cachedPath = path;
    cachedRoute = routeFromPath(path);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribeRoute, routeSnapshot, () => HOME);
}
