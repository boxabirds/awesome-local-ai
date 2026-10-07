import { useSyncExternalStore } from 'react';

/**
 * The three addresses this app has (PRD share.open_link, share.not_found):
 * `/` is the home page, `/b/<boardId>` is a board, everything else is "Board not
 * found". No router library: three routes do not justify a dependency, and History
 * API calls plus a listener are all `useRoute` needs.
 */
export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

/** `/b/<boardId>` — one segment, because only one board is open at a time. */
export const BOARD_PATH_PREFIX = '/b/';
const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/** The address of a board, for anything that shows or follows a link. */
export const boardPath = (boardId: string): string => `${BOARD_PATH_PREFIX}${boardId}`;

/**
 * A board's full link. It is spelled out from the id rather than read from the address
 * bar, because the two disagree the moment the bar carries a query or a fragment — and
 * what a person copies has to be the address the *board* is at (TC-22).
 */
export const boardLink = (origin: string, boardId: string): string =>
  `${origin.replace(/\/+$/, '')}${boardPath(boardId)}`;

/**
 * Which route a pathname asks for. Pure, so the rule is unit-testable without a
 * browser (and so `/b/UPPER_case-but-too_short` is visibly a board *address* that
 * names no board — `BoardPage` reports it as not found without a network call).
 */
export function routeFromPath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const match = BOARD_PATH.exec(pathname);
  if (match) {
    try {
      return { name: 'board', id: decodeURIComponent(match[1]!) };
    } catch {
      return { name: 'not_found' }; // a malformed percent-escape is not an address
    }
  }
  return { name: 'not_found' };
}

type Listener = () => void;

const listeners = new Set<Listener>();
let installed = false;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Tell the app the URL changed. `navigate` adds a history entry (the back button
 * leaves the board), while `replacePath` does not — it is for fixing an address that
 * was never addressable in the first place.
 */
export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
  emit();
}

export function replacePath(path: string): void {
  if (window.location.pathname !== path) window.history.replaceState(null, '', path);
  emit();
}

function subscribe(listener: Listener): () => void {
  if (!installed) {
    // Back/forward never goes through `navigate`, so the URL itself is the signal.
    window.addEventListener('popstate', emit);
    installed = true;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && installed) {
      window.removeEventListener('popstate', emit);
      installed = false;
    }
  };
}

const pathname = (): string => window.location.pathname;

/** The current route; re-renders on `navigate` and on back/forward. */
export function useRoute(): Route {
  return routeFromPath(useSyncExternalStore(subscribe, pathname, pathname));
}
