/**
 * Minimal pathname router (story 5, share.pages).
 *
 * Three routes:
 *   /          → home
 *   /b/:id     → board
 *   anything   → not_found
 *
 * Uses the History API (pushState + popstate). No router library.
 */
import { useSyncExternalStore, useCallback } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parsePathname(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = pathname.match(/^\/b\/([A-Za-z0-9_-]+)\/?$/);
  if (match !== null) {
    return { name: 'board', id: match[1]! };
  }
  return { name: 'not_found' };
}

/** Subscribe to pathname changes (pushState + popstate). */
function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function getSnapshot(): string {
  return window.location.pathname;
}

/**
 * React hook: returns the current route based on `location.pathname`.
 * Re-renders on popstate and navigate() calls.
 */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot);
  return parsePathname(pathname);
}

/** Navigate to a new path (pushState + dispatch popstate for React re-render). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  // Dispatch a popstate so useSyncExternalStore picks up the change.
  window.dispatchEvent(new PopStateEvent('popstate'));
}
