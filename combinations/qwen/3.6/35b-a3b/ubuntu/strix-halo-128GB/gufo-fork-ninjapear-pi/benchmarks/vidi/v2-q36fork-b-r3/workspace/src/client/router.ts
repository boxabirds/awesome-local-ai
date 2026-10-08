/** Minimal pathname router — no library. Uses History API. */

import { isValidBoardId } from '@shared/board-id';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

let currentRoute: Route = { name: 'home' };
const listeners: Array<(route: Route) => void> = [];

/**
 * Parse the current pathname into a route.
 *   / → home
 *   /b/:id (where :id is valid) → board
 *   anything else → not_found
 */
export function parseRoute(): Route {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';

  if (path === '/') {
    return { name: 'home' };
  }

  const match = path.match(/^\/b\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (isValidBoardId(id)) {
      return { name: 'board', id };
    }
  }

  return { name: 'not_found' };
}

/** Get the current route reactively. In tests, this reads from internal state. */
export function useRoute(): Route {
  return currentRoute;
}

/** Navigate to a new path, updating the route and history. */
export function navigate(path: string): void {
  if (typeof window !== 'undefined') {
    window.history.pushState({}, '', path);
  }
  currentRoute = parseRoute();
  fireListeners(currentRoute);
}

function fireListeners(route: Route): void {
  for (const fn of listeners) {
    fn(route);
  }
}

export function subscribe(fn: (route: Route) => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// Listen for popstate (browser back/forward)
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    currentRoute = parseRoute();
    fireListeners(currentRoute);
  });
}
