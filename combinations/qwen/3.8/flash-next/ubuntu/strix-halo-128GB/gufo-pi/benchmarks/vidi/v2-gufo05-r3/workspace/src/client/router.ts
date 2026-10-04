/**
 * The whole router vidi6 needs (story 5, `share.pages`).
 *
 * Three routes — the home page (`/`), a board (`/b/:id`) and Board not found
 * (anything else) — do not justify a router dependency, so this is a tiny
 * History-API router: read the address, re-render when it changes, and provide
 * `navigate` for creating a board and moving to it.
 *
 * The board id is taken from the path verbatim. Validation is deliberately not
 * done here: `BoardPage` decides between a real check and Board not found, so a
 * malformed id never reaches the network (share.not_found).
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The board address shape: `/b/<one segment>`. */
const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/** The route a pathname names. Pure, so it is unit-testable without a DOM. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match) return { name: 'board', id: match[1]! };
  return { name: 'not_found' };
}

/** Notified on every navigation that did not come from the browser's own Back. */
const NAVIGATE_EVENT = 'vidi6:navigate';

/**
 * Go to `path` and re-render. `history.pushState` fires no event, so a private
 * one is dispatched for the same reason `popstate` exists: to tell the current
 * tab its address changed.
 */
export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** The current route, kept live across Back/Forward and `navigate`. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const read = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', read);
    window.addEventListener(NAVIGATE_EVENT, read);
    // Pick up an address change that happened between render and subscribe.
    read();
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener(NAVIGATE_EVENT, read);
    };
  }, []);

  return route;
}
