/**
 * Worker entry: the whole HTTP surface of vidi6.
 *
 *   /api/rooms/:boardId   WebSocket upgrade for one board -> its BoardRoom
 *   /__test/boards/:id/…  test-only board surgery, routed only when TEST_HOOKS=1
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
import { TEST_HOOK_PREFIX } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * '1' in the test servers, unset in a production deploy. Only then are the
   * `/__test/boards/:id/...` routes forwarded to a room; without it those paths are
   * ordinary unknown paths and fall through to the SPA.
   */
  TEST_HOOKS?: string;
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

    if (env.TEST_HOOKS === '1' && pathname.startsWith(TEST_HOOK_PREFIX)) {
      const boardId = pathname.slice(TEST_HOOK_PREFIX.length).split('/')[0] ?? '';
      if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return room.fetch(request);
    }

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
