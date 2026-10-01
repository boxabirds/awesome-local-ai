// Where the app is: three addresses, and nothing a router library is needed for.
//
//   `/`          the home page
//   `/b/<id>`    one board
//   anything else  Board not found
//
// The id is *not* validated here: `/b/abc` is still "the page for board abc", and
// `BoardPage` decides that there is no such board. Telling those two apart matters
// because the answer - Board not found - is the same one the server gives for an
// unknown id, and it belongs to the page that asks the question.
//
// History API only, no hash routes: a link is the product, so the address has to be
// the real one. `navigate()` is a push, so the browser's Back returns to the home
// page rather than leaving; `popstate` is what makes a Back press re-render here.

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The board id in `/b/<id>`: 22 characters of base64url, and nothing else. */
const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/** The route for an address. Pure, so a test can ask it directly. */
export function routeFor(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match !== null) return { name: 'board', id: match[1] as string };
  return { name: 'not_found' };
}

/** Every hook that wants to know where we are. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Back and Forward move the address without going through `navigate()`.
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function getPathname(): string {
  return window.location.pathname;
}

/** The route of the address the window is at now, kept up to date. */
export function useRoute(): Route {
  return routeFor(useSyncExternalStore(subscribe, getPathname, getPathname));
}

/** Go to `path`, the way a link would: the address changes and Back comes back. */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  notify();
}

/** The address of one board, from its id. */
export function boardPath(id: string): string {
  return `/b/${id}`;
}
