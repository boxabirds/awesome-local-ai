import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const NAVIGATE_EVENT = 'vidi6:navigate';

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const m = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    try {
      return { name: 'board', id: decodeURIComponent(m[1]) };
    } catch {
      return { name: 'not_found' };
    }
  }
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

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname);
  return parseRoute(pathname);
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
