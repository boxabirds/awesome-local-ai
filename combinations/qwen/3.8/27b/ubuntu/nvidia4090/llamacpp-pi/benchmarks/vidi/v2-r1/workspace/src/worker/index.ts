// Worker entry (stories 3+4): routes /api/rooms/:boardId to the BoardRoom
// Durable Object and /__test/boards/:boardId/:op to the same DO (test hooks,
// registered only when env.TEST_HOOKS === '1'); everything else to assets.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { TEST_HOOK_OPS } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Set only in test environments (e2e wrangler config), never in production. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const TEST_PREFIX = '/__test/boards/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test hooks: only when explicitly enabled (never set in production config).
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith(TEST_PREFIX)) {
      const rest = url.pathname.slice(TEST_PREFIX.length);
      const [boardId, op] = rest.split('/');
      if (!isValidBoardId(boardId) || op === undefined || !(TEST_HOOK_OPS as readonly string[]).includes(op)) {
        return new Response('Not Found', { status: 404 });
      }
      const body = await req.arrayBuffer();
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(
        new Request(`http://internal/__test/${op}`, { method: 'POST', body }),
      );
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);

      // Validate board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      // Require WebSocket upgrade
      const upgradeHeader = req.headers.get('upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    // Everything else: static assets (SPA fallback handles /b/:boardId)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
