import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;
const NAVIGATE_EVENT = 'vidi6:navigate';

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match) {
    try { return { name: 'board', id: decodeURIComponent(match[1]) }; } catch { return { name: 'not_found' }; }
  }
  return { name: 'not_found' };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAVIGATE_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAVIGATE_EVENT, cb);
  };
}

/** The pathname is the snapshot (a string), so React re-renders only when it changes. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
