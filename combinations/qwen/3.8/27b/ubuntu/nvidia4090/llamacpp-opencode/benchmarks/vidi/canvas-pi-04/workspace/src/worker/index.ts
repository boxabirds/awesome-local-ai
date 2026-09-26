// Story 3: worker entry (anchor: sync.worker_entry).
//
// `/api/rooms/:boardId` upgrades to the BoardRoom Durable Object for that
// board; everything else is served from the built client (SPA). An invalid
// board id is rejected with 400 BEFORE any Durable Object is allocated.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom, type Env } from './board-room';
import { handleTestHooks } from './test-hooks';

const ROOM_PATH_PREFIX = '/api/rooms/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Story 4: test-only routes (guarded by env.TEST_HOOKS === '1').
    const hook = await handleTestHooks(req, env);
    if (hook !== null) {
      return hook;
    }
    if (url.pathname.startsWith(ROOM_PATH_PREFIX)) {
      const boardId = url.pathname.slice(ROOM_PATH_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const upgrade = req.headers.get('Upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return new Response('Upgrade Required', { status: 426 });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM.get(id).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
