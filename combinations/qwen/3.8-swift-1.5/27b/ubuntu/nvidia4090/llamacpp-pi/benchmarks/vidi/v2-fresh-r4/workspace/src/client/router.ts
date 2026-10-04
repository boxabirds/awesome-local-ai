/**
 * Minimal pathname router using the History API.
 * Routes: / (home), /b/:id (board), anything else → not_found.
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(): Route {
  const { pathname } = window.location;
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = pathname.match(/^\/b\/([A-Za-z0-9_-]{22})$/);
  if (match) {
    return { name: 'board', id: match[1] };
  }
  return { name: 'not_found' };
}

let currentRoute: Route = parseRoute();
const listeners = new Set<() => void>();

function emitChange() {
  currentRoute = parseRoute();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', emitChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', emitChange);
  };
}

function getSnapshot(): Route {
  return currentRoute;
}

/** React hook: returns the current route, re-renders on navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Navigate to a new path (pushState + emit change). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  emitChange();
}
