// src/worker/index.ts
// Cloudflare Worker entry: routes /api/rooms/:boardId to BoardRoom, /api/boards for creation/existence,
// everything else to static assets.

import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHooks } from './test-hooks';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  BOARD_ROOM: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): {
      fetch(req: Request): Promise<Response>;
      initialize(): Promise<'created' | 'exists'>;
      exists(): Promise<boolean>;
    };
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

    // POST /api/boards → create a new board
    if (url.pathname === '/api/boards' && req.method === 'POST') {
      const result = await createBoard(env);
      if (result.ok) {
        return new Response(JSON.stringify({ id: result.id }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Other methods on /api/boards → 405
    if (url.pathname === '/api/boards' && req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // GET /api/boards/:id → check existence
    const boardsGetMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardsGetMatch) {
      if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = boardsGetMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      try {
        const exists = await stub.exists();
        if (exists) {
          return new Response(JSON.stringify({ id: boardId }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      } catch {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomsMatch) {
      const boardId = roomsMatch[1];

      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
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
