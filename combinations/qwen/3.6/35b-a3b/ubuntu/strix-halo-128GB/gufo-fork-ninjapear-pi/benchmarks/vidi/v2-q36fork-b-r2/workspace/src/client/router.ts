/** Minimal pathname router using History API — no router library. */

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Parse current location pathname into a route. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  const match = pathname.match(/^\/b\/(.+)$/);
  if (match && BOARD_ID_PATTERN.test(match[1])) {
    return { name: 'board', id: match[1] };
  }
  // Anything else that looks like /b/anything → not found
  if (pathname.startsWith('/b/')) {
    return { name: 'not_found' };
  }
  return { name: 'home' };
}

let currentRoute: Route = parseRoute(window.location.pathname);

/** Get the current parsed route. */
export function useRoute(): Route {
  return currentRoute;
}

/** Navigate to a path, updating both history and the route state. */
export function navigate(path: string): void {
  history.pushState(null, '', path);
  currentRoute = parseRoute(path);
}

/** Subscribe to popstate events to update the route. */
export function setupRouter(onChange?: (route: Route) => void): void {
  window.addEventListener('popstate', () => {
    currentRoute = parseRoute(window.location.pathname);
    onChange?.(currentRoute);
  });
}
