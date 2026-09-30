import { useSyncExternalStore } from 'react';

// A tiny History-API router. Three routes do not justify a dependency (design).
export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = pathname.match(/^\/b\/([^/]+)$/);
  if (match) return { name: 'board', id: decodeURIComponent(match[1]) };
  return { name: 'not_found' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

function getPathname(): string {
  return window.location.pathname;
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getPathname, getPathname);
  return parseRoute(pathname);
}

/**
 * Navigate without a reload. `pushState` does not fire `popstate`, so we
 * dispatch it manually to wake `useRoute` subscribers.
 */
export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
