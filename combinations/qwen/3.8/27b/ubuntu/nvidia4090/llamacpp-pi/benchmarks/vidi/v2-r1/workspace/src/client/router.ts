// Minimal pathname router (story 5, navigation.routes).
//
// A tiny external store over window.history — no router library:
//   /            → home
//   /b/:boardId  → board page (the id is not validated here; BoardPage is)
//   anything else → not found
// Navigation is history.pushState plus a broadcast; back/forward come from
// 'popstate'. No hash routing: links must be plain, copyable paths.

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

type Listener = () => void;

const ROUTE_CHANGE_EVENT = 'vidi6:routechange';

function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = pathname.match(/^\/b\/(.+)$/);
  if (match !== null && match[1] !== '') return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

const listeners = new Set<Listener>();

// useSyncExternalStore requires a referentially stable snapshot for the same
// URL: cache the parsed route and only re-parse when the pathname changes.
let cachedPathname: string | null = null;
let cachedRoute: Route | null = null;

function getSnapshot(): Route {
  const pathname = window.location.pathname;
  if (cachedPathname !== pathname || cachedRoute === null) {
    cachedPathname = pathname;
    cachedRoute = parseRoute(pathname);
  }
  return cachedRoute;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange(): void {
  for (const listener of [...listeners]) listener();
}

// History fires 'popstate' for back/forward; pushState fires nothing, so
// navigate() also broadcasts a custom event.
window.addEventListener('popstate', emitChange);
window.addEventListener(ROUTE_CHANGE_EVENT, emitChange);

/** The route for the current location, re-rendering on navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Navigate within the app (pushState + broadcast). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}
