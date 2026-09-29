import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleTestRoute } from './test-hooks';
import type { Env } from './env';

const ROOM_PREFIX = '/api/rooms/';
const TEST_PREFIX = '/api/test/';

/**
 * Worker entry. Routes the Yjs WebSocket endpoint `/api/rooms/:boardId` to that
 * board's BoardRoom Durable Object and everything else to the static SPA assets.
 *
 * Each board gets its own object via `idFromName(boardId)` — that is what keeps
 * boards isolated (live.isolation). There is no participant counting anywhere:
 * capacity is soft (live.over_capacity), so more than MAX_CONCURRENT_EDITORS
 * people can always connect and edit.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test hooks (only in test mode)
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith(TEST_PREFIX)) {
      const res = await handleTestRoute(request, env, url);
      if (res) return res;
    }

    if (url.pathname.startsWith(ROOM_PREFIX)) {
      const boardId = decodeURIComponent(url.pathname.slice(ROOM_PREFIX.length));
      // Reject bad ids *before* touching the namespace: no object instance is
      // created for an invalid id (negative scenario TC-04).
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else (including /b/<boardId> via single-page-application
    // not_found_handling) is served by the static assets binding.
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
export type { Env };
