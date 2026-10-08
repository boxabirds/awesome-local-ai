/**
 * Minimal client-side router (story 5).
 *
 * Routes: `/` (home), `/b/:id` (board), anything else → not found.
 * Navigation is pushState + a popstate event (no history library); React
 * re-reads `location.pathname` on every popstate. `navigate()` is
 * idempotent enough for the create → `/b/<id>` redirect: the board page
 * performs its existence check, so an immediately-reloaded link works even
 * while the create response is still in flight (share.privacy).
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = BOARD_PATH.exec(pathname);
  if (match !== null && match[1] !== undefined && match[1].length > 0) {
    return { name: 'board', id: match[1] };
  }
  return { name: 'not_found' };
}

/** Current route, re-evaluated on popstate (and programmatic navigate). */
export function useRoute(): Route {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return parseRoute(pathname);
}

/**
 * Navigates to `path` and updates the in-memory route. Back/forward still
 * work: pushState entries are real history entries.
 */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
