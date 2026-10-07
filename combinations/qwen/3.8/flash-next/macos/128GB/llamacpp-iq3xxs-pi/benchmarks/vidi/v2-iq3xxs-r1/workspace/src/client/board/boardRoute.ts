import { isValidBoardId, newBoardId } from '../../shared/board-id';

/**
 * Board addresses (PRD live.board_url): `/b/<boardId>` *is* the board. Story 5
 * replaces the "make one up on the spot" case below with server-side board
 * creation; until then opening `/` starts a fresh, unguessable board.
 */
export const BOARD_PATH_PREFIX = '/b/';

/** The board id a path asks for, or null when it is not a board URL. */
export function boardIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(BOARD_PATH_PREFIX)) return null;
  const segment = pathname.slice(BOARD_PATH_PREFIX.length).replace(/\/+$/, '');
  if (segment === '' || segment.includes('/')) return null;
  return isValidBoardId(segment) ? segment : null;
}

/**
 * The board id to show, and the URL to show it at: an existing valid board URL is
 * left alone, anything else (`/`, a malformed id, a deep link) becomes a fresh
 * board. Pure, so the routing rule is unit-testable without a browser.
 */
export function resolveBoardId(pathname: string, id = newBoardId()): { boardId: string; path: string } {
  const existing = boardIdFromPath(pathname);
  if (existing) return { boardId: existing, path: `${BOARD_PATH_PREFIX}${existing}` };
  return { boardId: id, path: `${BOARD_PATH_PREFIX}${id}` };
}

/**
 * Put the current URL in board form *without* adding a history entry, so the back
 * button still leaves the board (design: `/` redirect, not `/` + push).
 */
export function ensureBoardPath(): string {
  const { boardId, path } = resolveBoardId(window.location.pathname);
  if (window.location.pathname !== path) {
    window.history.replaceState(null, '', path);
  }
  return boardId;
}
