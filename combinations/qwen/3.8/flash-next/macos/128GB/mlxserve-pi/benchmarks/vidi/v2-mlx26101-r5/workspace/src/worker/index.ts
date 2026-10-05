/**
 * The Worker entry point: the only thing that stands between a request and the
 * board it asked for.
 *
 *   GET /api/rooms/:boardId  (Upgrade: websocket)  →  that board's BoardRoom
 *   everything else                                →  the static client
 *
 * `idFromName(boardId)` is what keeps boards separate: every connection for a
 * board lands in that board's own object, which holds only that board's document
 * and only ever broadcasts to its own sockets.
 *
 * Nothing here counts participants. The simultaneous-editor capacity
 * (`MAX_CONCURRENT_EDITORS`) is a design and test target, so a 6th person joining a
 * board is accepted and can edit like anybody else.
 */

import { isValidBoardId } from '../shared/board-id';
import { ROOM_PATH_PREFIX } from '../shared/config';
import type { BoardRoom } from './board-room';

/** Bindings declared in `wrangler.jsonc`. */
export interface Env {
  /** One BoardRoom per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served with a single-page-application fallback. */
  ASSETS: Fetcher;
}

/** Every room request starts here; the rest of the path is the board id. */
const ROOM_PREFIX = `${ROOM_PATH_PREFIX}/`;

/** Everything under `/api/` belongs to the Worker, never to the client bundle. */
const API_PREFIX = '/api/';

/** True for a WebSocket upgrade request (the header is case-insensitive). */
function isUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/** A machine-readable error for an API request; never the client's index.html. */
function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-vidi6-error': code },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith(ROOM_PREFIX)) {
      const boardId = path.slice(ROOM_PREFIX.length);
      // A board id is 22 base64url characters; anything else is a bad address, and
      // it is answered here so that no object instance is ever created for it.
      if (!isValidBoardId(boardId)) {
        return apiError(400, 'invalid_board_id', 'A board id is 22 characters of [A-Za-z0-9_-].');
      }
      // The route exists only as a WebSocket. A plain GET would otherwise be an
      // assets miss rendered as index.html, which is useless to a client.
      if (!isUpgrade(request)) {
        return apiError(426, 'upgrade_required', 'This board is reachable over a WebSocket.');
      }
      // `idFromName` is the whole isolation story: one stable id per board, so every
      // connection to a board reaches that board's room and no other.
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    // Any other `/api/` path is a bad address, and a client shell served there
    // would be fetched as if it were data.
    if (path === '/api' || path.startsWith(API_PREFIX)) {
      return apiError(404, 'not_found', `No such endpoint: ${path}`);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom } from './board-room';
