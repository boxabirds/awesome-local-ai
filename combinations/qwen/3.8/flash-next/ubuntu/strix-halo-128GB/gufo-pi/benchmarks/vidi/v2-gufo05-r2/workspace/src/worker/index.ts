/**
 * Worker entry: the whole HTTP surface of vidi6.
 *
 *   /api/rooms/:boardId   WebSocket upgrade for one board -> its BoardRoom
 *   everything else       the client bundle (static assets, SPA fallback)
 *
 * `idFromName(boardId)` gives every board its own Durable Object holding its own
 * `Y.Doc`, which is what keeps boards separate (live.isolation): a change on one
 * board is applied and broadcast inside one object and never leaves it.
 *
 * Nothing here counts participants: MAX_CONCURRENT_EDITORS is a soft design and
 * test target, so a 6th person on a board is accepted like anyone else
 * (live.over_capacity).
 */

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

/**
 * Path prefix of the realtime endpoint; the next segment is the board id.
 * Not exported: every export of a Worker entry module must be the default
 * handler or a Durable Object class.
 */
const ROOM_PATH_PREFIX = '/api/rooms/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(ROOM_PATH_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    const boardId = pathname.slice(ROOM_PATH_PREFIX.length);
    if (!isValidBoardId(boardId)) {
      return new Response('Invalid board id', { status: 400 });
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return room.fetch(request);
  },
};

export { BoardRoom };
