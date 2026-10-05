/**
 * The vidi6 Worker: the front door of a board.
 *
 * Two jobs, and nothing else.
 *
 *  - `/api/rooms/<boardId>` is a WebSocket upgrade for that board. The board id
 *    is validated first (an address that is not 22 base64url characters is a
 *    client mistake, not a room), then the request is forwarded to *that board's
 *    own* `BoardRoom` object. `idFromName(boardId)` is what keeps boards apart:
 *    every connection for a board lands in the same object, and no object ever
 *    sees another board's traffic (`live.isolation`).
 *  - everything else is the client: static assets, with an `index.html` fallback
 *    so `/b/<boardId>` is a client route rather than a file.
 *
 * Neither the Worker nor the room counts participants. The product's capacity
 * (`MAX_CONCURRENT_EDITORS`) is a design and test target, so a 6th person joining
 * a board is accepted exactly like anyone else (`live.over_capacity`).
 */

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

/** Bindings declared in `wrangler.jsonc`. */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

/** Everything under this prefix is one board's WebSocket endpoint. */
const ROOM_PREFIX = '/api/rooms/';

/** Is this the WebSocket handshake? (The client sends `Upgrade: websocket`.) */
function wantsWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/** The board id in the path, or null when the path is not a valid address. */
function boardIdOf(pathname: string): string | null {
  const raw = pathname.slice(ROOM_PREFIX.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape is just a bad address.
    return null;
  }
  return isValidBoardId(decoded) ? decoded : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(ROOM_PREFIX)) return env.ASSETS.fetch(request);

    const boardId = boardIdOf(url.pathname);
    if (boardId === null) return new Response('Invalid board id', { status: 400 });
    if (!wantsWebSocketUpgrade(request)) {
      return new Response('Upgrade Required', { status: 426 });
    }

    // One object per board id: that is the whole of the board's isolation.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  }
};

export { BoardRoom };
