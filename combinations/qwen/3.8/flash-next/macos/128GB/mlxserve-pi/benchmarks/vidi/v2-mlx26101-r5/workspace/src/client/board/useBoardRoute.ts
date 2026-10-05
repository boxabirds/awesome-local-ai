import { useCallback, useEffect, useState } from 'react';

import { isValidBoardId, newBoardId } from '../../shared/board-id';

/** Boards live under this path: `/b/<board id>`. */
export const BOARD_PATH_PREFIX = '/b/';

/** Which board the address asks for, or the one to show instead. */
export type BoardRoute =
  | { kind: 'board'; boardId: string }
  /** The address names a board, but the name is not one: nothing is joined. */
  | { kind: 'invalid'; boardId: string };

/** The address of a board. */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

/**
 * Reads a board out of a path.
 *
 * `/b/<valid id>` is that board. `/`, `/b/` and anything else we did not recognise
 * send the visitor to `freshBoardId`, which the caller made beforehand: this function
 * does not create one itself, because it is called during render and a render that
 * quietly changes the address bar is a render that cannot be relied on.
 *
 * A `/b/<something>` that is not a board id is not redirected away: it is an address
 * somebody typed or pasted, and it has to stay on screen to be explained.
 */
export function boardRoute(pathname: string, freshBoardId: string): BoardRoute {
  if (!pathname.startsWith(BOARD_PATH_PREFIX)) return { kind: 'board', boardId: freshBoardId };
  const segment = (pathname.slice(BOARD_PATH_PREFIX.length).split('?')[0] ?? '').split('/')[0] ?? '';
  const boardId = decodeURIComponent(segment);
  if (boardId === '') return { kind: 'board', boardId: freshBoardId };
  return isValidBoardId(boardId) ? { kind: 'board', boardId } : { kind: 'invalid', boardId };
}

/** What `useBoardRoute` gives the app. */
export interface BoardRouteHook {
  /** The board to show. Never "no board": an unknown address is a new board. */
  route: BoardRoute;
  /** Goes to a board of this visit's own, replacing whatever was on screen. */
  startNewBoard(): void;
}

/**
 * The board this page is on, from the address bar — and the address bar kept in step
 * with it.
 *
 * The fresh id for `/` is made once per mount, before anything looks at it, so that a
 * re-render (which happens on every keystroke) cannot hand the visitor a different
 * board. The address is written with `replaceState` for `/` — a board you were never
 * asked for should not be in your back history — and with `pushState` when you ask for
 * a new one.
 */
export function useBoardRoute(): BoardRouteHook {
  const [visit] = useState(() => ({ freshBoardId: newBoardId() }));
  const [pathname, setPathname] = useState<string>(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onLocation = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    return () => {
      window.removeEventListener('popstate', onLocation);
      window.removeEventListener('hashchange', onLocation);
    };
  }, []);

  const route = boardRoute(pathname, visit.freshBoardId);

  const path = boardPath(route.kind === 'board' ? route.boardId : '');
  useEffect(() => {
    if (typeof window === 'undefined' || route.kind !== 'board') return;
    if (window.location.pathname !== path) window.history.replaceState({}, '', path);
  }, [path, route.kind]);

  const startNewBoard = useCallback((): void => {
    const next = boardPath(newBoardId());
    if (typeof window !== 'undefined') window.history.pushState({}, '', next);
    setPathname(next);
  }, []);

  return { route, startNewBoard };
}
