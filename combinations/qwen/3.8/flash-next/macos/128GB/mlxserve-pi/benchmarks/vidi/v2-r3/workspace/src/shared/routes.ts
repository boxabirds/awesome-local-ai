/**
 * The two paths one board address appears in: `/b/<id>` for a person opening
 * the board, `/api/rooms/<id>` for their connection to it. Both the Worker and
 * the client need them, and the id has to reach the board room unchanged.
 */
import { isValidBoardId, newBoardId } from './board-id';

export const BOARD_PATH_PREFIX = '/b/';
export const ROOM_PATH_PREFIX = '/api/rooms/';

/**
 * The board collection: `POST` here creates a board, `GET /api/boards/<id>` asks
 * whether one exists (story 5). The worker routes on it, the client calls it, and
 * the tests check all three against this one string so the address a person opens
 * and the address the client asks about cannot drift apart.
 */
export const BOARDS_PATH = '/api/boards';

/** The existence endpoint for one board. */
export function boardApiPath(boardId: string): string {
  return `${BOARDS_PATH}/${boardId}`;
}

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

// --- Story 12: where an image's bytes go, and where they come from ------------
//
// An image is the first thing on the board that does not live in the document, so
// it is the first thing with two addresses of its own: one to put bytes at, one to
// read them back from. Both are here rather than in the one file that uses them
// because the client uploads and the Worker serves, and the address either side
// writes down has to be the address the other side listens on.

/** The path segment under a board where its images are uploaded. */
export const BOARD_ASSETS_SUFFIX = '/assets';

/** The path prefix an image's bytes are served from. */
export const ASSETS_PATH_PREFIX = '/api/assets';

/**
 * Where the bytes of a file dropped on board `boardId` are uploaded:
 * `POST /api/boards/<boardId>/assets`. The board's id is in the address, so the
 * Worker can check the board exists before it stores anything, and one board's
 * bytes cannot be filed under another's name.
 */
export function boardAssetsPath(boardId: string): string {
  return `${BOARDS_PATH}/${boardId}${BOARD_ASSETS_SUFFIX}`;
}

/**
 * Where the bytes stored under an asset key are read back from, with each half of
 * the key escaped so that a key can only ever name the one asset it is (TC-16).
 */
export function assetPath(assetKey: string): string {
  const parts = assetKey.split('/').map((part) => encodeURIComponent(part));
  return `${ASSETS_PATH_PREFIX}/${parts.join('/')}`;
}
