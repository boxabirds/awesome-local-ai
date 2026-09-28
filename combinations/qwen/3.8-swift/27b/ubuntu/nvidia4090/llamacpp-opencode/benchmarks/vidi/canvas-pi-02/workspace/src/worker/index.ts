// Worker entry (story 3, sync.worker_entry): routes /api/rooms/:boardId to
// the board's BoardRoom Durable Object and everything else to the static
// assets. Each board id maps to its own object instance, which is what
// isolates boards (PRD live.isolation). There is deliberately no connection
// limit check: the capacity is soft (MAX_CONCURRENT_EDITORS) and over-
// capacity joiners are never refused (PRD live.over_capacity).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { testHookRoute } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' only in the e2e dev env file (tests/e2e/helpers); enables
   *  /_test/ hooks. Production config never sets it. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return Promise.resolve(new Response('Bad Request', { status: 400 }));
      }
      if (!req.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM.get(id).fetch(req);
    }
    if (env.TEST_HOOKS === '1') {
      // Story 4 e2e hooks (persist.load_failure); 404 in production.
      const parts = url.pathname.split('/').filter(Boolean);
      const boardId = parts[1] ?? '';
      if (isValidBoardId(boardId)) {
        const room = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
        return testHookRoute(req, room);
      }
    }
    return Promise.resolve(env.ASSETS.fetch(req));
  },
};

export { BoardRoom };
