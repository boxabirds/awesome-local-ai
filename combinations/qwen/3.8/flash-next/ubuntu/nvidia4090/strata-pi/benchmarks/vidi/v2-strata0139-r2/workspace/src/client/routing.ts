/**
 * Which board this screen is on: the `/b/<boardId>` route.
 *
 * The path rules live here so the router (`router.tsx`), the API client
 * (`api.ts`) and the share link all spell the address the same way.
 */

import { isValidBoardId } from "../shared/board-id";

/** The one page that is not a board and not an error. */
export const HOME_PATH = "/";

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

/** The path a board lives at. */
export function boardPath(boardId: string): string {
  return `/b/${boardId}`;
}
