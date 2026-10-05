/**
 * Which board this screen is on: the `/b/<boardId>` route.
 *
 * There is no router in this app yet (story 5 brings the board list), so the
 * URL is read directly. A board id that is not a valid id is not a board: the
 * client treats the URL as "no board chosen".
 */

import { isValidBoardId } from "../shared/board-id";

/** The board id in `/b/<boardId>`, or null when the path names no board. */
export function boardIdFromPath(pathname: string): string | null {
  const match = /^\/b\/([^/?#]+)\/?$/.exec(pathname);
  const candidate = match?.[1];
  if (candidate === undefined) return null;
  try {
    if (!isValidBoardId(decodeURIComponent(candidate))) return null;
  } catch {
    return null; // a percent-escape that is not valid UTF-8 names no board
  }
  return candidate;
}
