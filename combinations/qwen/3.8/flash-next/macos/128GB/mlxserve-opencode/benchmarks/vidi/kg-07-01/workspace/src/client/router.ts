// A minimal pathname router (three routes do not justify a router library):
//   /          home
//   /b/:id     a board (the id is validated by the board page, so malformed ids show Board not found)
//   anything else → not found
import { useSyncExternalStore } from 'react';

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]*)\/?$/;
const NAVIGATE_EVENT = 'vidi6:navigate';

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
  const pathname = useSyncExternalStore(subscribe, currentPath);
  // Route objects are rebuilt per render; consumers compare by name/id.
  return routeFor(pathname);
}

/** Goes to `path` in this tab (History API; no page load). */
export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
