/**
 * Which page this window is showing, read from its address.
 *
 * Three addresses, so there is no router library: `/` is the home page, `/b/<id>` is a board, and
 * anything else is the page that says there is nothing here. A fourth would have to earn its
 * dependency, and this one earns nothing — it is the History API with a listener on it.
 *
 * The address is the truth and the app follows it, which is the whole reason this file exists.
 * A board's link is its only access control, so the address in the bar is not a hint about what
 * page to show but the thing the page is about; and it is why `/` no longer invents a board (story
 * 3 did, before there was a service to make one in): an address that was made up by whoever
 * arrived at it cannot be sent to anybody else, which is the one thing a board address is for.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** The page this window is on. */
export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

/** Every board address starts with this, and the rest of it is the board's id. */
export const BOARD_PATH_PREFIX = '/b/';

/** The address of a board, from its id. This is the link a person is given. */
export function boardPath(id: string): string {
  return `${BOARD_PATH_PREFIX}${id}`;
}

/**
 * Which page an address is for.
 *
 * The id is not checked here. An address of the form `/b/<something>` is *about* a board whatever
 * that something is, and the page that decides whether the board exists is the one that has the
 * request to ask with — which is also the page that has to hold the address up against the id
 * rules before it sends anything anywhere.
 */
export function routeFor(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname.startsWith(BOARD_PATH_PREFIX)) {
    const id = pathname.slice(BOARD_PATH_PREFIX.length);
    if (id !== '' && !id.includes('/')) return { name: 'board', id };
  }
  return { name: 'not_found' };
}

function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

/**
 * The address, as React state.
 *
 * `getSnapshot` re-reads the address and hands back the same object until it changes, which is what
 * `useSyncExternalStore` asks for — and it is a re-read rather than a remembered value on purpose:
 * an address can change without this module being told (a test putting one there directly, a
 * fragment the browser resolves before the app has mounted), and a route remembered from the last
 * event would show a page for an address that is no longer in the bar.
 */
let seenPathname: string | null = null;
let seenRoute: Route = { name: 'home' };

function getSnapshot(): Route {
  const pathname = currentPathname();
  if (pathname !== seenPathname) {
    seenPathname = pathname;
    seenRoute = routeFor(pathname);
  }
  return seenRoute;
}

const subscribers = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  if (subscribers.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('popstate', onLocationChange);
  }
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('popstate', onLocationChange);
    }
  };
}

function onLocationChange(): void {
  subscribers.forEach((onChange) => {
    onChange();
  });
}

/**
 * Go to another address in this window.
 *
 * `pushState`, so the back button goes back to the page the person was on and the address they end
 * up with is the one they could send to somebody. Nothing here reloads: the app is the same app at
 * every address, and the only reason to ask the server for a document is the board's connection,
 * which is opened by the page that this navigation brings up.
 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  onLocationChange();
}

/** Open a board in this window. */
export function openBoard(id: string): void {
  navigate(boardPath(id));
}

/** The page this window is on, re-rendered when the address changes. */
export function useRoute(): Route {
  const subscribeToRoute = useCallback((onChange: () => void) => subscribe(onChange), []);
  return useSyncExternalStore(subscribeToRoute, getSnapshot, getSnapshot);
}
