/**
 * Minimal pathname router (story 5): `/` → home, `/b/:id` → board, anything
 * else → not found. History API only; no router library.
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)\/?$/);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

const listeners = new Set<() => void>();
let cachedPathname: string | null = null;
let cachedRoute: Route = { name: 'home' };

function emit(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  // pushState does not fire popstate; navigate() emits manually, and
  // back/forward (popstate) is covered here.
  window.addEventListener('popstate', emit);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Route {
  const pathname = window.location.pathname;
  if (pathname !== cachedPathname) {
    cachedPathname = pathname;
    cachedRoute = parseRoute(pathname);
  }
  return cachedRoute;
}

/** The current route, reactive to history changes. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Navigate via history.pushState and notify subscribers. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  emit();
}
