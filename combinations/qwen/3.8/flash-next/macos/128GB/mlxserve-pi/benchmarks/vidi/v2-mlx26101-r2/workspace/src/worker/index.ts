/**
 * The Worker entry point: the only thing in front of the client assets.
 *
 * `/api/rooms/:boardId` is the board's live connection: a valid id with an
 * `Upgrade: websocket` header is forwarded to that board's `BoardRoom` Durable
 * Object, and everything else — the board page itself, the scripts and styles
 * it loads — comes from the static assets.
 *
 * Boards stay separate because `idFromName(boardId)` gives every board its own
 * object, which holds only that board's document and broadcasts only to its own
 * sockets. Nobody is ever counted or turned away: the simultaneous-editor
 * capacity is a design and test target, not a limit (see MAX_CONCURRENT_EDITORS).
 */

import { isValidBoardId } from '../shared/board-id.js';
import { BoardRoom } from './board-room.js';

export interface Env {
  /** The board rooms: one Durable Object per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not a room. */
  ASSETS: Fetcher;
}

/** The prefix of the live-connection route. */
const ROOM_PREFIX = '/api/rooms/';

/** The board id in `/api/rooms/:boardId`, or `''` for `/api/rooms` itself. */
const boardIdOf = (pathname: string): string => pathname.slice(ROOM_PREFIX.length);

const isRoomPath = (pathname: string): boolean =>
  pathname === '/api/rooms' || pathname.startsWith(ROOM_PREFIX);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!isRoomPath(pathname)) {
      // The board page, the SPA fallback for `/b/<id>` and every asset.
      return env.ASSETS.fetch(request);
    }

    const boardId = boardIdOf(pathname);
    if (!isValidBoardId(boardId)) {
      // An id that is not 22 base64url characters is not a board: say so, and
      // never create a room for it.
      return new Response('invalid board id', { status: 400 });
    }
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    // One object per board id: the isolation between boards is this call.
    const roomId = env.BOARD_ROOM.idFromName(boardId);
    return env.BOARD_ROOM.get(roomId).fetch(request);
  },
};

// The Durable Object class has to be exported from the entry point for the
// runtime to bind it.
export { BoardRoom };
