/**
 * Which board this page is on.
 *
 * `/b/<boardId>` names a board. Anything else (in this story: `/`) becomes a
 * brand new board: an address is created and the address bar is replaced with
 * it, so the page can be reloaded, bookmarked, or handed to someone else.
 *
 * Story 5 (people, boards, and finding them again) is what will later list
 * boards and let a person choose one; until then the only way to reach an
 * existing board is its address.
 */

import { isValidBoardId, newBoardId } from '../../shared/board-id';
import { BOARD_PATH_PREFIX } from '../../shared/config';

/** The board a path names, or `null` when it names none. */
export function boardIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(BOARD_PATH_PREFIX)) {
    return null;
  }
  const candidate = decodeURIComponent(pathname.slice(BOARD_PATH_PREFIX.length));
  return isValidBoardId(candidate) ? candidate : null;
}

/**
 * The board this page should be on. A path that names one wins; otherwise a new
 * board address is created and the address bar is changed to it.
 */
export function resolveBoardId(history: History, pathname: string): string {
  const named = boardIdFromPath(pathname);
  if (named !== null) {
    return named;
  }
  const fresh = newBoardId();
  history.replaceState(null, '', `${BOARD_PATH_PREFIX}${fresh}`);
  return fresh;
}
