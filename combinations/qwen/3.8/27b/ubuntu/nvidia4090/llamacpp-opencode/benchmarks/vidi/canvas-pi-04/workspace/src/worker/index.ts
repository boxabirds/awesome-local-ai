// Story 3: worker entry (anchor: sync.worker_entry).
//
// Routes:
//   POST /api/boards          create a board (story 5, share.board_api):
//                             rate-limited per visitor, 201 { id } | 429
//                             { error: 'rate_limited' } | 500 { error:
//                             'create_failed' }.
//   GET  /api/boards/:boardId  board existence check (story 5): 200 | 404.
//   /api/rooms/:boardId        upgrades to the BoardRoom Durable Object for
//                             that board; 404 for unknown or invalid board
//                             ids BEFORE a socket opens, 426 for a valid id
//                             without an Upgrade header.
//   everything else            served from the built client (SPA).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom, type Env } from './board-room';
import { createBoard } from './create-board';
import { handleTestHooks } from './test-hooks';

const BOARDS_PATH = '/api/boards';
const BOARD_PATH = /^\/api\/boards\/([^/]+)\/?$/;
const ROOM_PATH_PREFIX = '/api/rooms/';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The visitor key for the creation rate limit (share.rate_limit): the
 * connecting IP. In production this is always set by Cloudflare (req.cf);
 * the CF-Connecting-IP header is the fallback for local runtimes where the
 * cf object is absent (workerd tests, wrangler dev).
 */
function visitorKeyOf(req: Request): string {
  return (
    req.cf?.connectingIP ?? req.headers.get('CF-Connecting-IP') ?? 'unknown'
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Story 4: test-only routes (guarded by env.TEST_HOOKS === '1').
    const hook = await handleTestHooks(req, env);
    if (hook !== null) {
      return hook;
    }

    // POST /api/boards: create a board (story 5).
    if (url.pathname === BOARDS_PATH) {
      if (req.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      const result = await createBoard(env, visitorKeyOf(req));
      if (result.ok) {
        return json({ id: result.id }, 201);
      }
      if (result.reason === 'rate_limited') {
        return json({ error: 'rate_limited' }, 429);
      }
      return json({ error: 'create_failed' }, 500);
    }

    // GET /api/boards/:boardId: existence check (story 5).
    const boardMatch = BOARD_PATH.exec(url.pathname);
    if (boardMatch !== null) {
      if (req.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      const boardId = boardMatch[1]!;
      if (!isValidBoardId(boardId)) {
        // Invalid ids 404 WITHOUT allocating a room (share.board_api).
        return json({ error: 'not_found' }, 404);
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const exists = await env.BOARD_ROOM.get(id).exists();
      if (!exists) {
        return json({ error: 'not_found' }, 404);
      }
      return json({ id: boardId }, 200);
    }

    if (url.pathname.startsWith(ROOM_PATH_PREFIX)) {
      const boardId = url.pathname.slice(ROOM_PATH_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        // Story 5: unknown/invalid ids are 404 (was 400 in story 3).
        return new Response('Not Found', { status: 404 });
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
