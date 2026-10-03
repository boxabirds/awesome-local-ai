/**
 * Worker entry point.
 *
 * Routes (story 5):
 * - `POST /api/boards` → create a board (201 {id} / 500 {error})
 * - `GET /api/boards/:id` → existence check (200 {id} / 404 {error})
 * - `GET /api/rooms/:boardId` → that board's BoardRoom Durable Object
 *   (404 for unknown or malformed ids; 426 without `Upgrade: websocket`)
 * - `/__test/...` → test-only hooks (only when the TEST_HOOKS binding is '1')
 * - everything else → the static assets (SPA fallback)
 *
 * No participant counting: capacity (MAX_CONCURRENT_EDITORS) is a soft
 * design/test target, never enforced.
 */

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' enables the /__test routes (set via wrangler.jsonc vars for tests). */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)\/?$/;
const BOARDS_PATH = /^\/api\/boards\/?$/;
const BOARD_PATH = /^\/api\/boards\/([^/]+)\/?$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (env.TEST_HOOKS === '1') {
      const hook = await handleTestHook(req, env, url);
      if (hook) return hook;
    }

    // POST /api/boards → create; other methods → 405.
    if (BOARDS_PATH.test(url.pathname)) {
      if (req.method === 'POST') {
        const failInitialize = req.headers.get('x-vidi6-test-fail-initialize') === '1';
        const result = await createBoard(env, { failInitialize });
        return result.ok
          ? json({ id: result.id }, 201)
          : json({ error: 'create_failed' }, 500);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    // GET /api/boards/:id → existence check. Unknown AND malformed ids are
    // both 404 (no distinction, nothing leaked); malformed ids never touch
    // the namespace.
    const boardMatch = url.pathname.match(BOARD_PATH);
    if (boardMatch) {
      if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = boardMatch[1];
      if (!isValidBoardId(boardId)) {
        return json({ error: 'not_found' }, 404);
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
    }

    // WebSocket rooms.
    const match = url.pathname.match(ROOM_PATH);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return json({ error: 'not_found' }, 404);
      }
      const upgrade = req.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
