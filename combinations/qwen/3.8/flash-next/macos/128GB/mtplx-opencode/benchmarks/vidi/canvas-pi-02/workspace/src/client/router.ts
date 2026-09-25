/**
 * The pathname router (story 5, task 1.1).
 *
 * Three shapes, and the whole app is a choice between them:
 *
 *  - `/` is the Home page: no board is implied;
 *  - `/b/<id>` and `/board/<id>` name a board, but only when `<id>` has the
 *    shape of a board id — a truncated link is a "Board not found", not a
 *    fresh empty board that looks like the person's own;
 *  - anything else is a "Board not found" too. There is no other page.
 *
 * It is a pure function of a pathname so the router can be tested without a
 * browser (TC-14) and so `main.tsx` and the component harness see the exact
 * same decision. A pathname is split and matched, never handed to `URL`, so a
 * stray query or fragment comes off before any shape test.
 */
import { BOARD_ID_PATTERN, BOARD_PATH_PREFIX } from '../shared/board-id';
import { BOARD_LINK_PREFIX } from '../shared/board-id';

/** The two prefixes that name a board: the share link and the legacy path. */
export const BOARD_PREFIXES = [BOARD_LINK_PREFIX, BOARD_PATH_PREFIX] as const;

/** Which page a pathname asks for, and the board it names if it names one. */
export type Route =
  | { page: 'home' }
  | { page: 'board'; boardId: string }
  | { page: 'not_found'; attempted: string };

/**
 * The board id a path names, or `null`.
 *
 * A board lives under one of {@link BOARD_PREFIXES}; the id is the single
 * segment after the prefix, checked against the id shape. `/b` (no slash) and
 * `/b/<id>/extra` are not boards. A percent-decode is attempted first because
 * a pasted link can arrive encoded, but a decoded value still has to pass the
 * shape test, so `%2F` and `%20` inside the id fail closed.
 */
export function boardIdInPath(pathname: string): string | null {
  // A query or a fragment is never part of an id. `resolveRoute` strips them
  // too, and so does this: the function is also handed whole URLs, and a link
  // that arrives with `?utm_…` still names a real board.
  const path = pathname.split('?')[0]?.split('#')[0] ?? '';
  for (const prefix of BOARD_PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    // Exactly one segment after the prefix, and it must be a whole id.
    if (rest.length === 0 || rest.includes('/')) continue;
    let candidate = rest;
    try {
      candidate = decodeURIComponent(rest);
    } catch {
      // A malformed escape is not an id.
      return null;
    }
    // The decode must not have smuggled a slash or widened the shape.
    if (candidate.includes('/') || !BOARD_ID_PATTERN.test(candidate)) return null;
    return candidate;
  }
  return null;
}

/**
 * Resolve a pathname to the page it asks for.
 *
 * Order matters: `/` is Home before anything else so the bare origin is never
 * mistaken for a board attempt; then a board path; then everything else is a
 * not-found. This is the function `main.tsx` mounts on and the router test
 * drives with generated paths (TC-14).
 */
export function resolveRoute(pathname: string): Route {
  const clean = pathname.split('?')[0]?.split('#')[0] ?? '';
  if (clean === '' || clean === '/') return { page: 'home' };
  const boardId = boardIdInPath(clean);
  if (boardId !== null) return { page: 'board', boardId };
  return { page: 'not_found', attempted: clean };
}

/**
 * True for a path that *looks like* a board link but is not one.
 *
 * `/` is the normal way to arrive and warning there is noise; `/b/<id-short>`
 * is a link truncated in Slack, and naming it lets the not-found page say
 * "check the link" rather than pretending to be a board.
 */
export function isBrokenBoardLink(pathname: string): boolean {
  const clean = pathname.split('?')[0]?.split('#')[0] ?? '';
  if (BOARD_PREFIXES.some((prefix) => clean.startsWith(prefix))) {
    return boardIdInPath(clean) === null;
  }
  return false;
}