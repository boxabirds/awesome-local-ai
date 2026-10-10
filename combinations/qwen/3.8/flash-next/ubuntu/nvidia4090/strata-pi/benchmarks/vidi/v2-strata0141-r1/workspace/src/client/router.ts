import { useEffect, useState } from 'react';
import { BOARD_PATH_PREFIX } from '../shared/config';

/**
 * Which page the address bar names (`share.open_link`, `share.not_found`).
 *
 * The app has three pages and the address bar is the only thing that decides
 * between them: `/` is the home page, `/b/<id>` is a board, and anything else is
 * the Board not found page. A link that opens in a new tab, a bookmark, a reload
 * and the Back button all arrive through here, and they all get the same page.
 *
 * The route carries the id exactly as the address spelled it. Whether that id is
 * well formed is the board page's question - the router only says which page the
 * address names, so a malformed id still lands on the board page, which answers
 * it without ever calling the server (TC-19).
 */

export type Route =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'not_found' };

/** The page a path names. Exported as `route` for the spec's naming. */
export function route(pathname: string): Route {
  if (pathname === '/' || pathname === '') {
    return { name: 'home' };
  }
  if (pathname.startsWith(BOARD_PATH_PREFIX)) {
    const id = decodeURIComponent(pathname.slice(BOARD_PATH_PREFIX.length)).replace(/\/+$/, '');
    if (id !== '' && !id.includes('/')) {
      return { name: 'board', id };
    }
  }
  return { name: 'not_found' };
}

/** The address a board's link should show (`share.copy_link`). */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

const listeners = new Set<(route: Route) => void>();

/**
 * Show another page and put its address in the address bar.
 *
 * Every in-app move goes through here, so the address bar always matches the
 * page on screen - which is what makes a reload or the Back button land on the
 * same page (TC-26).
 */
export function navigate(path: string): void {
  if (path === currentPath()) {
    return;
  }
  window.history.pushState({ path }, '', path);
  emit();
}

function currentPath(): string {
  return window.location.pathname;
}

function emit(): void {
  const now = route(currentPath());
  for (const listener of [...listeners]) {
    listener(now);
  }
}

/** The route this component should render, kept current across navigation. */
export function useRoute(): Route {
  const [value, setValue] = useState<Route>(() => route(currentPath()));
  useEffect(() => {
    const listener = (next: Route) => setValue(next);
    listeners.add(listener);
    // The Back button, Forward, and a bookmark reload all change the address
    // without going through `navigate`.
    window.addEventListener('popstate', emit);
    emit();
    return () => {
      listeners.delete(listener);
      window.removeEventListener('popstate', emit);
    };
  }, []);
  return value;
}
