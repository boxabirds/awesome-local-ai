// Worker entry: route `/api/rooms/:boardId` to that board's BoardRoom Durable
// Object, and serve everything else from the static client assets.
//
// Routing is by board id only. `idFromName(boardId)` sends every connection for
// a board to that board's own object, which holds only that board's document and
// broadcasts only to its own sockets — so people on different boards never see
// each other's changes (live.isolation). Nothing here counts participants: a
// person joining a board that already has MAX_CONCURRENT_EDITORS (5) or more is
// accepted like anyone else (live.over_capacity).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export { BoardRoom };

/**
 * The Worker bindings, merged into the global `Cloudflare.Env` in `env.d.ts` so
 * wrangler, the Durable Object and `cloudflare:test` all agree on one type.
 */
export type Env = Cloudflare.Env;

const ROOM_PREFIX = '/api/rooms/';

/** The board id in `/api/rooms/:boardId`, or null when the path is not a room. */
function boardIdOf(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_PREFIX)) return null;
  const rest = pathname.slice(ROOM_PREFIX.length);
  // exactly one path segment, no trailing content
  if (rest === '' || rest.includes('/')) return null;
  return decodeURIComponent(rest);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const boardId = boardIdOf(url.pathname);
    if (boardId === null) return env.ASSETS.fetch(request);

    // Validate before touching the namespace: an invalid id must never create an
    // object instance (TC-04).
    if (!isValidBoardId(boardId)) {
      return new Response('Invalid board id', { status: 400 });
    }

    // A valid board id reached over plain HTTP is a missing WebSocket upgrade.
    const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};
