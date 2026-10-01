/**
 * The two paths one board address appears in: `/b/<id>` for a person opening
 * the board, `/api/rooms/<id>` for their connection to it. Both the Worker and
 * the client need them, and the id has to reach the board room unchanged.
 */
import { isValidBoardId, newBoardId } from './board-id';

export const BOARD_PATH_PREFIX = '/b/';
export const ROOM_PATH_PREFIX = '/api/rooms/';

/** The page for a board. */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}

/** The socket for a board, relative to the origin it is served from. */
export function roomPath(boardId: string): string {
  return `${ROOM_PATH_PREFIX}${boardId}`;
}

/**
 * The board a path names: the id from `/b/<id>`, and nothing else. An address
 * that is not a board address gives no id here — the caller decides what that
 * means (the Worker answers, or the client makes a board and goes to it).
 */
export function boardIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(BOARD_PATH_PREFIX)) return null;
  const id = pathname.slice(BOARD_PATH_PREFIX.length);
  // Something after the id is not a board address, however well it starts:
  // `/b/../x` names no board, and neither does `/b/<id>/extra`.
  if (!isValidBoardId(id)) return null;
  return id;
}

/**
 * The board a browser is on: the id from `/b/<id>` when the path names one, and
 * a new id when it does not (the root, or an address that is not a board
 * address). A board id is the whole of what a board is here, so there is
 * nothing to look up first — an unknown address simply becomes a new board.
 */
export function boardIdForPath(pathname: string, makeId: () => string = newBoardId): string {
  return boardIdFromPath(pathname) ?? makeId();
}
