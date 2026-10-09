/**
 * Minimal pathname router (story 5, share.routes).
 *
 * Routes: `/` -> home, `/b/:id` -> board, anything else -> not found.
 * Navigation is pushState + a listener so pages swap without reloading;
 * popstate keeps back/forward working.
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const m = pathname.match(/^\/b\/([^/]+)\/?$/);
  if (m) return { name: 'board', id: m[1] };
  return { name: 'not_found' };
}

let listeners: Array<() => void> = [];

function emitChange(): void {
  for (const l of [...listeners]) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emitChange);
}

function subscribe(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

function getSnapshot(): string {
  return location.pathname;
}

/** The current route, re-evaluated on pushState (via navigate) and popstate. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot, () => '/');
  return parseRoute(pathname);
}

/** SPA navigation: pushState + notify. (Full reloads work too; the server
 * always answers `/b/:id` with the SPA index.) */
export function navigate(path: string): void {
  if (location.pathname === path) return; // nothing changed
  history.pushState(null, '', path);
  emitChange();
}
