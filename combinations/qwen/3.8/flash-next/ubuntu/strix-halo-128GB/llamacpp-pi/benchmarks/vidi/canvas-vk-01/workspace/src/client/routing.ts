import { isValidBoardId, newBoardId } from '../shared/board-id';

/**
 * Board routing: a board lives at `/b/<boardId>`. There is no router library;
 * the app reads the id from the pathname, and a path without one (`/`, until
 * story 5 adds the board dashboard) starts a fresh board.
 */

/** Path a board is served from. */
export function boardPath(boardId: string): string {
  return `/b/${boardId}`;
}

/** The valid board id in `pathname`, or `null` when the path has none. */
export function boardIdFromPathname(pathname: string): string | null {
  const match = /^\/b\/([^/?#]+)/.exec(pathname);
  if (match === null) return null;
  const candidate = decodeURIComponent(match[1]);
  return isValidBoardId(candidate) ? candidate : null;
}

/**
 * Board id for the current URL, normalising the URL as a side effect: `/` (or
 * any path without a valid id) gets a new id in the address bar without a
 * navigation, so a reload lands on the same board.
 *
 * The pathname is re-read after `replaceState` so the returned id always
 * matches the address bar even when React runs this twice (StrictMode).
 */
export function resolveBoardId(): string {
  const existing = boardIdFromPathname(window.location.pathname);
  if (existing !== null) return existing;
  window.history.replaceState(null, '', boardPath(newBoardId()));
  const created = boardIdFromPathname(window.location.pathname);
  if (created === null) {
    throw new Error(`could not start a board at ${window.location.pathname}`);
  }
  return created;
}
