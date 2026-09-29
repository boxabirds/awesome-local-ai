import { useSyncExternalStore } from 'react';

/**
 * Minimal client-side router (story 5, share.urls).
 *
 * Routes: `/` (home), `/b/:boardId` (board), anything else (not found).
 * `navigate` pushes history and updates the shared snapshot; the browser
 * back/forward button fires `popstate`, which does the same. No URL is ever
 * rewritten by the app (story 2's fresh-board redirect is gone — the home
 * page owns "create").
 */

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

/** Parses a pathname into a route (exported for tests). */
export function parseRoute(pathname: string): Route {
  const m = pathname.match(/^\/b\/([^/]+)/);
  if (m) return { name: 'board', id: m[1] };
  if (pathname === '/' || pathname === '') return { name: 'home' };
  return { name: 'not_found' };
}

let current = parseRoute(window.location.pathname);
const listeners = new Set<() => void>();

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  return a.name !== 'board' || b.name !== 'board' || a.id === b.id;
}

function emit(): void {
  for (const l of [...listeners]) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): Route {
  // Re-sync on every read: the location can change without a popstate
  // (pushState from outside the app, e.g. tests). The cached object is only
  // replaced when the route actually changed, so the snapshot stays
  // referentially stable between renders.
  const fresh = parseRoute(window.location.pathname);
  if (!sameRoute(current, fresh)) current = fresh;
  return current;
}

window.addEventListener('popstate', () => {
  current = parseRoute(window.location.pathname);
  emit();
});

/** Re-renders the subscribing component on every navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Client-side navigation (pushState + snapshot update; no page reload). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  current = parseRoute(path);
  emit();
}
