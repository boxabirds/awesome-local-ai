import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parsePathname(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

// useSyncExternalStore requires a stable snapshot; cache by pathname.
let cachedPathname: string | null = null;
let cachedRoute: Route | null = null;

export function getRoute(): Route {
  const pathname = window.location.pathname;
  if (cachedPathname !== pathname || cachedRoute === null) {
    cachedRoute = parsePathname(pathname);
    cachedPathname = pathname;
  }
  return cachedRoute;
}

const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emitChange);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Minimal pathname router (no router library): `/` → home, `/b/:id` → board,
 * anything else → not found. Reacts to history navigation (popstate) and to
 * `navigate()`.
 */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute);
}

/** Navigate via History API and notify listeners. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  emitChange();
}
