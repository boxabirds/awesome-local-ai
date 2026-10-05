/**
 * The router, which is a URL and three shapes.
 *
 * There are three pages because there are three things a person can arrive at: nowhere in
 * particular (`/`), a board (`/b/<id>`), and an address that is neither (`share.not_found`).
 * Every board page is the same document served by the Worker and then filled with that
 * board's content, which is what makes `/b/<id>` a route rather than a file — and what makes
 * the Worker's asset-and-API split a boundary rather than a convenience (`share.link_stable`).
 *
 * `window.location` is the state, and the counter below is only a change signal: the back
 * button, `navigate` and a reload all end by reading the same thing, so they cannot disagree
 * about which page is on screen.
 *
 * No router library: three routes do not justify a dependency, and the one behaviour that
 * matters — the back button returning to the previous board — is a `popstate` listener.
 */

import { useMemo, useSyncExternalStore } from 'react';

/** Which page the current URL asks for. */
export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'not_found' };

/** The path of a board: the part of a shared link that is not the origin. */
export function boardPath(id: string): string {
  return `/b/${id}`;
}

/**
 * Read a path as a route.
 *
 * `/b/` with anything in the second segment is a *board* route, even when that segment is
 * nonsense: deciding whether an address is a real board belongs to `BoardPage`, so that the
 * check, the request and the retry all live in one state machine instead of being split
 * across a router that guesses. An empty second segment, or a path that is not `/b/` at all,
 * is not found.
 */
export function routeFor(pathname: string): Route {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return { name: 'home' };
  if (segments[0] === 'b') {
    if (segments.length !== 2) return { name: 'not_found' };
    try {
      return { name: 'board', id: decodeURIComponent(segments[1]) };
    } catch {
      // A percent-escape that does not decode is not a board address, and is not worth
      // distinguishing from one that merely has the wrong length.
      return { name: 'not_found' };
    }
  }
  return { name: 'not_found' };
}

/** The current URL, as a route. */
export function currentRoute(): Route {
  return routeFor(window.location.pathname);
}

/**
 * Bumped whenever the URL changes by anything other than a reload.
 *
 * `history.pushState` notifies nobody, so `navigate` bumps this itself; the back button is
 * `popstate`, which bumps it too. Reading the version is what makes `useRoute` re-read the
 * URL rather than trust a cached one.
 */
let version = 0;
const listeners = new Set<() => void>();

function announce(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', announce);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', announce);
  };
}

/**
 * Go to a path inside this app, keeping the back button working.
 *
 * `pushState` rather than `location.href`: a board is a page you can leave and return to,
 * and reloading the document to move between two of them would drop the one thing the
 * address bar is for (`share.link_stable`).
 */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  announce();
}

/** The route for the URL this component is rendering, kept current. */
export function useRoute(): Route {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => version,
    () => version
  );
  return useMemo(() => currentRoute(), [snapshot]);
}
