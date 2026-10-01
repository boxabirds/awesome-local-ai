// src/worker/index.ts
// Cloudflare Worker entry: routes /api/rooms/:boardId to BoardRoom, everything else to static assets.

import { BoardRoom } from './board-room';
import { handleTestHooks } from './test-hooks';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  BOARD_ROOM: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): { fetch(req: Request): Promise<Response> };
  };
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Debug: check if test hooks are reachable
    if (url.pathname === '/__test/debug') {
      return new Response(JSON.stringify({ test_hooks: env.TEST_HOOKS, path: url.pathname }), { headers: { 'content-type': 'application/json' } });
    }

    // Test hooks (only active when TEST_HOOKS === '1')
    const testHookResponse = handleTestHooks(req, env);
    if (testHookResponse) return testHookResponse;

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomsMatch) {
      const boardId = roomsMatch[1];

      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }

    // Everything else: serve static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
