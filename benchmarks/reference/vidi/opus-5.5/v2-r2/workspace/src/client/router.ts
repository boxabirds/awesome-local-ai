// Minimal pathname router (share.pages): three routes do not justify a library.
import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;
const NAVIGATE_EVENT = 'vidi6:navigate';

/** `/` → home, `/b/:id` → board (the page validates the id), anything else → not found. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match?.[1]) {
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

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

const pathname = () => window.location.pathname;

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, pathname);
  return parseRoute(path);
}

/** Pushes `path` onto the history and re-renders the router. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
