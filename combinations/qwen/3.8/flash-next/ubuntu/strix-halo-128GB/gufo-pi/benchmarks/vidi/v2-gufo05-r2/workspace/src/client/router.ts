/**
 * The whole of this app's routing: three addresses and one hook (design §3).
 *
 *   /            the home page, where a board is made
 *   /b/<id>      one board
 *   anything else  "Board not found"
 *
 * It is a handful of functions rather than a library because the app has three
 * pages and no nested paths: `useRoute()` reports where the address bar says we
 * are, `navigate()` moves it with the History API (no reload, no request to the
 * server), and the browser's own Back and Forward arrive as `popstate`.
 *
 * A board id is not *validated* here: the router reports what the address says, and
 * BoardPage decides whether it is one of ours (share.not_found). That keeps the
 * difference between "this is not even an address" and "nobody created this board"
 * in one place, where the existence check is.
 */

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The address of one board. */
export function boardPath(id: string): string {
  return `/b/${id}`;
}

/** What an address means. Never throws, whatever the address bar contains. */
export function routeFromPath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length === 2 && segments[0] === 'b') {
    return { name: 'board', id: decode(segments[1] ?? '') };
  }
  // `/b` on its own, `/boards/<id>`, `/settings`: no such page. The page that
  // answers is the one that says so, rather than a redirect to somewhere else.
  return { name: 'not_found' };
}

const listeners = new Set<() => void>();

/**
 * Move to another address without reloading the page.
 *
 * `pushState` deliberately does not fire an event, so the subscribers are told here;
 * Back and Forward fire `popstate` and reach the same listeners.
 */
export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

/** Where the address bar says this page is, re-rendered when it changes. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  );
  return routeFromPath(pathname);
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A half-written address is not a board id; it is a string that will be
    // refused by the existence check, which is the honest answer for it.
    return segment;
  }
}
