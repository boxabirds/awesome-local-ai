import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]*)\/?$/;

/**
 * The route for a pathname: `/` home, `/b/:id` board (the id is checked by BoardPage), anything
 * else not found.
 */
export function routeFor(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match) {
    let id: string;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return { name: 'not_found' };
    }
    return { name: 'board', id };
  }
  return { name: 'not_found' };
}

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}

const currentPath = () => window.location.pathname;

/** Opens `path` in the app with a new history entry (Back returns to the previous page). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  notify();
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, currentPath);
  return routeFor(pathname);
}
