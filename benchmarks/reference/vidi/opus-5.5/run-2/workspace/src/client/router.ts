/**
 * Minimal pathname router (anchor: share.pages): `/` home, `/b/:id` a board, anything
 * else not found. History API only — three routes do not justify a router library.
 */
import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_ROUTE = /^\/b\/([^/]+)\/?$/;
const NAVIGATE_EVENT = 'vidi6:navigate';

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_ROUTE.exec(pathname);
  if (match?.[1] !== undefined) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
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

/** The route for the current address; re-renders on navigate() and back/forward. */
export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, currentPath));
}
