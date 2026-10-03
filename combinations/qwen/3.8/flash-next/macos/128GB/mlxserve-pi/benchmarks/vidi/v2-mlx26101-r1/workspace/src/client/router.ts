// The whole router for story 5: three addresses and nothing else.
//
//   /            home page (New board)
//   /b/<id>      the board at that link
//   anything else  "Board not found"
//
// It is deliberately tiny — a pathname plus `popstate` — because the alternative
// (a router dependency) buys a lot of surface for three routes. `navigate()` goes
// through `history.pushState`, so the address bar ends up holding exactly the link
// that would be shared, and Back works like it does anywhere else.

import { useSyncExternalStore } from 'react';
import { isValidBoardId } from '../shared/board-id';

/** Which page the current address asks for. */
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/**
 * The route for a pathname. A `/b/...` whose id is not a link is `not_found` here,
 * so a garbage suffix never even reaches the board page (and never asks the
 * service): `/b/not-a-board` and `/anything/else` give the same answer.
 */
export function routeFromPathname(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match !== null) {
    const id = match[1] as string;
    return isValidBoardId(id) ? { name: 'board', id } : { name: 'not_found' };
  }
  return { name: 'not_found' };
}

/** Listeners notified when the address changes (pushstate does not fire popstate). */
const listeners = new Set<() => void>();

/** The address the app is showing, read from the browser. */
export function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

/**
 * The route for the address the app is showing. The result is cached per pathname:
 * `useSyncExternalStore` compares snapshots by identity, so recomputing a fresh
 * object on every call would look like a change and re-render forever.
 */
let cachedPathname: string | null = null;
let cachedRoute: Route = { name: 'home' };

export function currentRoute(): Route {
  const pathname = currentPathname();
  if (pathname !== cachedPathname) {
    cachedPathname = pathname;
    cachedRoute = routeFromPathname(pathname);
  }
  return cachedRoute;
}

/**
 * Go to another page of the app without reloading it. The address bar is the point
 * of this app — the link in it is what gets shared — so navigation always leaves
 * the right address behind.
 */
export function navigate(path: string): void {
  if (window.location.pathname === path) {
    emit();
    return;
  }
  window.history.pushState(null, '', path);
  emit();
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onPopState = () => listener();
  window.addEventListener('popstate', onPopState);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', onPopState);
  };
}

/** The route, re-rendered whenever the address changes. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, currentRoute);
}
