/**
 * The app router (story 5, task 1.1).
 *
 * `main.tsx` mounts this, and it is the only thing that decides which page a
 * pathname gets. It is a thin shell over {@link resolveRoute}: resolve, render,
 * and re-render when history changes. There is no router library and no
 * client-side route table — three pages and a pure resolver is the whole thing,
 * which keeps the whole router testable without a browser (TC-14).
 */
import { useSyncExternalStore } from 'react';
import { resolveRoute, type Route } from './router';
import { HomePage } from './pages/Home';
import { BoardPage } from './pages/Board';
import { NotFoundPage } from './pages/NotFound';

/** The pathname to render. In a browser, the live location; in tests, `/`. */
function currentPathname(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

/**
 * Subscribe to history so a back/forward re-runs the resolver.
 *
 * We deliberately do not intercept link clicks: the only in-app navigation that
 * matters (Create a board) is a real `location.assign`, which lands here with a
 * fresh document and a fresh session. That is simpler than a client router and
 * costs nothing at three pages.
 */
function usePathname(): string {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('popstate', notify);
      return () => window.removeEventListener('popstate', notify);
    },
    currentPathname,
    () => '/',
  );
}

/** Resolve and render. Exported for the router tests, which pass a pathname. */
export function renderRoute(route: Route): React.ReactElement {
  if (route.page === 'home') return <HomePage />;
  if (route.page === 'board') return <BoardPage key={route.boardId} boardId={route.boardId} />;
  return <NotFoundPage reason="malformed" attempted={route.attempted} />;
}

/** The mounted shell. */
export function Root(): React.ReactElement {
  const pathname = usePathname();
  return renderRoute(resolveRoute(pathname));
}