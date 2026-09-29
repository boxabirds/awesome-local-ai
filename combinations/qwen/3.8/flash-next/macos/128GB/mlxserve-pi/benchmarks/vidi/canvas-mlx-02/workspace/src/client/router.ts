// The three addresses this app answers, as a pure function of a path. Nothing
// here touches the network: a code that is not a code is answered here and now,
// without a request, because there is nothing worth asking about it (PRD
// share.not_found).
import { BOARD_ID_PATTERN } from '../shared/board-id.ts';

export const BOARD_PATH_PREFIX = '/b/';

/**
 * What a path asks for. `not_found` covers both a code that cannot be a code
 * (wrong characters, wrong length) and a path that is not a board path at all:
 * both are answered by the same page, and neither sends a request.
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'board'; boardId: string }
  | { kind: 'not_found'; boardId: string | null };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  if (pathname === '/b' || pathname === '/b/') {
    return { kind: 'not_found', boardId: null };
  }
  if (pathname.startsWith(BOARD_PATH_PREFIX)) {
    const rest = pathname.slice(BOARD_PATH_PREFIX.length);
    // A trailing slash is the same address as the code without one: anything
    // after the code is not part of it.
    const candidate = rest.split('/')[0];
    if (!BOARD_ID_PATTERN.test(candidate)) return { kind: 'not_found', boardId: candidate };
    return { kind: 'board', boardId: candidate };
  }
  return { kind: 'not_found', boardId: null };
}

/** The address of a board, as a path. */
export function boardPath(boardId: string): string {
  return `${BOARD_PATH_PREFIX}${boardId}`;
}
