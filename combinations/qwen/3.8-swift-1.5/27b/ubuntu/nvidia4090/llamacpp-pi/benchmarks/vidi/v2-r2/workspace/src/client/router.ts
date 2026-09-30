import { useSyncExternalStore } from 'react';

/**
 * Minimal pathname router (no library), story 5:
 *   /        → home (New board)
 *   /b/:id   → board (existence check, then the board UI)
 *   anything else → not_found
 * Uses the History API directly; browser back/forward re-renders via popstate.
 */
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return { name: 'board', id: decodeURIComponent(match[1]) };
  return { name: 'not_found' };
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): string {
  return window.location.pathname;
}

// Browser back/forward (popstate does not fire for pushState — navigate()
// notifies listeners itself).
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    for (const l of [...listeners]) l();
  });
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getSnapshot);
  return parseRoute(pathname);
}

/** Programmatic navigation (used by the "New board" actions). */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  for (const l of [...listeners]) l();
}
