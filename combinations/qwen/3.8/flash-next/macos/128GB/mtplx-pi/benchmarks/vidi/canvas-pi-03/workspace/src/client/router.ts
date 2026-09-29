// Minimal pathname router (share.pages).
//
// Three routes do not justify a router library. Everything is derived from
// `location.pathname` and driven through the History API:
//
//   /            → home  (Create a board)
//   /b/:id       → board (BoardPage checks existence)
//   anything else→ not_found
//
// `useRoute` re-renders the app when the path changes (popstate from the
// browser back/forward buttons). `navigate` pushes a new entry WITHOUT a
// reload, which is what lets "Create a board" land on the new board and the
// copied link open directly on BoardPage.

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Pure: pathname → route. The `/b/` id is NOT validated here (a malformed id
 * is still a `board` route; BoardPage decides it is "not found" without a
 * request, matching the design's "no request sent for malformed ids"). */
export function routeFromPath(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname.startsWith('/b/')) {
    const raw = pathname.slice('/b/'.length);
    // Only a single path segment is a board; anything deeper is not found.
    if (raw.length > 0 && !raw.includes('/')) return { name: 'board', id: decodeURIComponent(raw) };
  }
  return { name: 'not_found' };
}

function currentPathname(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const handler = () => onChange();
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}

/** The current route, re-rendered on popstate. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, currentPathname, currentPathname);
  return routeFromPath(pathname);
}

/** Push a new pathname (no reload) and notify subscribers. */
export function navigate(path: string): void {
  if (typeof window === 'undefined' || typeof window.history?.pushState !== 'function') return;
  window.history.pushState(null, '', path);
  // popstate does NOT fire for pushState, so dispatch it ourselves to make
  // useRoute re-read the path.
  window.dispatchEvent(new PopStateEvent('popstate'));
}
