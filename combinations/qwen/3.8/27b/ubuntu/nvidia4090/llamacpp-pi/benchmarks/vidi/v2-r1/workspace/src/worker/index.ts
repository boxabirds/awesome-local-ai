// Worker entry (stories 3–5): routes /api/boards and /api/boards/:id to the
// board creation / existence API, /api/rooms/:boardId to the BoardRoom
// Durable Object (404 for unknown or malformed boards), and /__test/boards/
// :boardId/:op to the same DO (test hooks, registered only when
// env.TEST_HOOKS === '1'); everything else to assets.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { TEST_HOOK_OPS } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Set only in test environments (e2e wrangler config), never in production. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';
const BOARDS_PREFIX = BOARDS_PATH + '/';
const TEST_PREFIX = '/__test/boards/';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

    // Board creation: POST /api/boards → 201 {"id"} (share.create).
    if (url.pathname === BOARDS_PATH) {
      if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
      const result = await createBoard(env);
      if (result.ok) return json(201, { id: result.id });
      return json(500, { error: result.reason });
    }

    // Board existence: GET /api/boards/:id → 200 {"id"} / 404 (share.not_found).
    // Unknown and malformed ids are indistinguishable (nothing leaked).
    if (url.pathname.startsWith(BOARDS_PREFIX)) {
      if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
      const boardId = url.pathname.slice(BOARDS_PREFIX.length);
      // Validate before touching the namespace: malformed ids never
      // instantiate a Durable Object (TC-07).
      if (!isValidBoardId(boardId)) return json(404, { error: 'not_found' });
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      if (exists) return json(200, { id: boardId });
      return json(404, { error: 'not_found' });
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);

      // Story 5: malformed ids are 404 (was 400 in story 3).
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
      }

      // Require WebSocket upgrade
      const upgradeHeader = req.headers.get('upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object; it answers 404 for boards that do not
      // exist (share.not_found) before accepting a socket.
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    // Everything else: static assets (SPA fallback handles /b/:boardId)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
