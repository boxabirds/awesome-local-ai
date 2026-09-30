// Minimal pathname router on the History API (no router library for three routes).
import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]*)\/?$/;
const NAVIGATE_EVENT = 'vidi6:navigate';

/** `/` → home, `/b/:id` → board (the id is validated by BoardPage), else not_found. */
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

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

const currentPath = () => window.location.pathname;

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, currentPath, currentPath);
  return routeFor(pathname);
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
