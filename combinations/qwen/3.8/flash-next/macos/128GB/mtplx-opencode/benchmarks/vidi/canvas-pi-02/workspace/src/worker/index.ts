/**
 * The board Worker (story 3).
 *
 * Two jobs, and deliberately nothing else:
 *
 *  - `/api/rooms/<boardId>` with a valid id and an `Upgrade: websocket`
 *    request is forwarded to the BoardRoom object named after that board. The
 *    name *is* the isolation boundary: two boards can never share a room
 *    because they can never share an object id.
 *  - everything else is handed to the static assets binding, which answers
 *    `/b/<boardId>` with index.html (single-page-application fallback).
 *
 * There is no participant counting and no capacity check: the configured
 * capacity is a design and test target, never a door that closes (PRD
 * live.over_capacity). An invalid board id is refused with 400 before a room
 * is looked up, so a malformed address cannot reach anybody's board.
 */
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './env';

/** Everything under this prefix is a room address, valid or not. */
const ROOM_PREFIX = '/api/rooms/';

/** Split `/api/rooms/<id>` into its id and whatever trailing junk follows. */
function roomAddress(pathname: string): { boardId: string; rest: string } | null {
  if (!pathname.startsWith(ROOM_PREFIX)) return null;
  const remainder = pathname.slice(ROOM_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash === -1) return { boardId: remainder, rest: '' };
  return { boardId: remainder.slice(0, slash), rest: remainder.slice(slash) };
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

function plainError(status: number, statusText: string, body: string): Response {
  return new Response(body, { status, statusText });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const address = roomAddress(url.pathname);

    if (address === null) {
      // Not a room: the assets binding serves the app, including the
      // `/b/<boardId>` single-page fallback.
      return env.ASSETS.fetch(request);
    }

    let boardId = address.boardId;
    try {
      boardId = decodeURIComponent(boardId);
    } catch {
      return plainError(400, 'Bad Request', 'invalid board id');
    }

    // Checked before any object is looked up: an address that cannot name a
    // board must not create or touch one (TC-04).
    if (address.rest !== '' || !isValidBoardId(boardId)) {
      return plainError(400, 'Bad Request', 'invalid board id');
    }
    if (!isWebSocketUpgrade(request)) {
      return plainError(426, 'Upgrade Required', 'upgrade to websocket required');
    }

    const id = env.BOARD_ROOM.idFromName(boardId);
    const room = env.BOARD_ROOM.get(id);
    return room.fetch(request);
  },
};

export type { Env };
export { BoardRoom } from './board-room';
