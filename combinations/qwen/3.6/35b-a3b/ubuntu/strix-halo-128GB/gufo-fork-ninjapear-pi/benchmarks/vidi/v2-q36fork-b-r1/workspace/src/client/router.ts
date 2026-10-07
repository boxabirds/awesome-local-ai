/**
 * Client-side router — minimal pathname → route mapping.
 * Story 5 — share a board with others using a link.
 *
 * No router library needed for three routes:
 *   /              → home
 *   /b/:id         → board (valid board id)
 *   anything else  → not_found
 */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** Determine the current route from window.location.pathname. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const match = /^\/b\/([A-Za-z0-9_-]{22})$/.exec(pathname);
  if (match) return { name: 'board', id: match[1] };
  return { name: 'not_found' };
}

/** Hook that tracks the current route via popstate events. */
export function useRoute(): Route {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    function onPopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return parseRoute(pathname);
}

/** Navigate to a new path, pushing onto history. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  // Trigger react to re-render
  window.dispatchEvent(new PopStateEvent('popstate'));
}
