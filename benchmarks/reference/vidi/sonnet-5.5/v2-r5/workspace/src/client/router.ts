import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;
const NAVIGATE_EVENT = 'vidi6:navigate';

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  return match ? { name: 'board', id: match[1] } : { name: 'not_found' };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAVIGATE_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAVIGATE_EVENT, cb);
  };
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(path);
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
