/**
 * Story 3 · URL routing for the Worker entrypoint; story 4 added the test-only
 * paths.
 *
 * These helpers used to live in `index.ts`. They had to move: the Workers
 * runtime treats *every* named export of an entrypoint module as a potential
 * service entrypoint, so a plain `export const ROOM_PATH_PREFIX = '…'` there
 * makes workerd refuse to start ("Incorrect type for map entry
 * 'ROOM_PATH_PREFIX'"). Keeping the entrypoint module to its default handler
 * and the `BoardRoom` class — and keeping the routing rules here, where they
 * can be unit-tested — avoids that whole class of failure.
 */

/** The path a board's room lives under (must match `config.ROOM_PATH_PREFIX`). */
export const ROOM_PATH_PREFIX = '/api/rooms/';

/** Prefix of the story 4 test-only routes (`TEST_HOOKS=1` only). */
export const TEST_PATH_PREFIX = '/__test/boards/';

/** A 16-byte board id rendered as URL-safe base64 (22 characters). */
const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{22}(?:[a-zA-Z0-9_-]{2}==)?$/;

/**
 * True when `pathname` is a room upgrade for a syntactically valid board id.
 * Kept cheap and dependency-free; the `BoardRoom` re-validates the payload, and
 * a malformed id never reaches a room so it cannot be used to probe the DO.
 */
export function parseRoomRequest(
  pathname: string,
): { ok: true; boardId: string } | { ok: false } {
  if (!pathname.startsWith(ROOM_PATH_PREFIX)) return { ok: false };
  const boardId = decodeURIComponent(pathname.slice(ROOM_PATH_PREFIX.length));
  if (!BOARD_ID_PATTERN.test(boardId)) return { ok: false };
  return { ok: true, boardId };
}

/** True when `pathname` addresses one of the test-only routes. */
export function isTestPath(pathname: string): boolean {
  return pathname.startsWith(TEST_PATH_PREFIX);
}
