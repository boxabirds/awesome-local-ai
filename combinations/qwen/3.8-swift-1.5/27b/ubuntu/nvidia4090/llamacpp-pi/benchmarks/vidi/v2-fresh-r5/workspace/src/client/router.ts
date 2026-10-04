/**
 * Minimal pathname router (story 5): `/` → home, `/b/:id` → board, anything
 * else → not found. History API based (no router library): `navigate()`
 * pushStates, `useRoute()` subscribes to pushState and popstate so browser
 * back/forward re-renders the right page.
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

function emitChange(): void {
  for (const listener of [...listeners]) listener();
}

/** Push `path` onto the history and notify the router. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  emitChange();
}

/** The current route; re-renders on navigation (pushState or popstate). */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      window.addEventListener('popstate', onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener('popstate', onChange);
      };
    },
    () => window.location.pathname,
  );
  return parseRoute(pathname);
}
