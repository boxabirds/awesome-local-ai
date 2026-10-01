import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match) return { name: 'board', id: decodeURIComponent(match[1]) };
  return { name: 'not_found' };
}

const NAVIGATE_EVENT = 'vidi6:navigate';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

/** Subscribes to the pathname (a string, so the snapshot is stable) and parses it. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
