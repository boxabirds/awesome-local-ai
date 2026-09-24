/**
 * Minimal pathname router (story 5): three routes do not justify a router library.
 *
 *   /          home
 *   /b/:id     board (the id is validated by BoardPage, so malformed ids reach Board not found)
 *   anything   not found
 */
import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;
/** Fired on same-document navigations made by navigate(); popstate covers back/forward. */
const NAVIGATE_EVENT = 'vidi6:navigate';

export function routeFor(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match?.[1] !== undefined) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function currentPath(): string {
  return window.location.pathname;
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, currentPath);
  return routeFor(pathname);
}

/** Same-document navigation (History API): no reload. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
