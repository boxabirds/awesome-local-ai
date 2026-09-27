// Minimal History-API router: '/' home, '/b/:id' board, anything else not found.

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    for (const listener of listeners) listener();
  });
}

export function parsePath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match) {
    let id = match[1]!;
    try {
      id = decodeURIComponent(id);
    } catch {
      // keep the raw value: it will fail validation and render not-found
    }
    return { name: 'board', id };
  }
  return { name: 'not_found' };
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function currentPath(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

/** pushState + notify, so navigation re-renders without a page load. */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, currentPath, () => '/');
  return parsePath(pathname);
}
