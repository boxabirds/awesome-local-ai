/**
 * The board sync route (`sync.worker_entry`).
 *
 * `/api/rooms/:boardId` is the only path that reaches a BoardRoom, so the
 * mapping from a request path to a board id lives here — as pure logic, so the
 * traversal cases are testable without a Worker.
 */

import { isValidBoardId } from './board-id';

export const ROOM_ROUTE_PREFIX = '/api/rooms/';

/**
 * The board id a request path asks for, or null when the path is not a room
 * path at all. Percent-decoding happens here, after the path has already been
 * resolved, so an encoded `..` can never climb out of the prefix: whatever is
 * left has to match the board id pattern, and board ids contain no slashes.
 */
export function boardIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_ROUTE_PREFIX)) {
    return null;
  }
  const raw = pathname.slice(ROOM_ROUTE_PREFIX.length);
  let boardId: string;
  try {
    boardId = decodeURIComponent(raw);
  } catch {
    // Broken percent-encoding is not a board id either.
    return null;
  }
  return isValidBoardId(boardId) ? boardId : null;
}
