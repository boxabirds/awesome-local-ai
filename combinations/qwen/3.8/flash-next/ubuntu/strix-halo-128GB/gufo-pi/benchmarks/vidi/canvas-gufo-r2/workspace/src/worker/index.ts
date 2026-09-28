/**
 * Worker entry: routes /api/rooms/:boardId to BoardRoom Durable Object,
 * /api/boards for creation and existence checks,
 * everything else to static assets.
 */
import { isValidBoardId } from '../shared/board-id';
import { matchTestHook } from './test-hooks';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  BOARD_CREATE_LIMITER: RateLimiter;
  /**
   * Set to '1' by the e2e wrangler process only (`--var TEST_HOOKS:1`). Enables
   * the /__test/boards/:id/* storage hooks; never set in wrangler.jsonc.
   */
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test-only storage hooks, forwarded to the board's Durable Object.
    if (env.TEST_HOOKS === '1') {
      const route = matchTestHook(url.pathname, url.searchParams);
      if (route !== null && isValidBoardId(route.boardId)) {
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(route.boardId));
        return stub.fetch(req);
      }
    }

    // Board creation and existence API
    if (url.pathname === '/api/boards' || url.pathname.startsWith('/api/boards/')) {
      return handleBoardsApi(req, env, url);
    }

    // Route WebSocket upgrade to Durable Object
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Strip any trailing path segments (e.g. /api/rooms/id/ws)
      const idPart = boardId.split('/')[0];

      if (!isValidBoardId(idPart)) {
        return new Response('Not found', { status: 404 });
      }

      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const doId = env.BOARD_ROOM.idFromName(idPart);
      const stub = env.BOARD_ROOM.get(doId);

      // Check existence before forwarding
      const exists = await stub.exists();
      if (!exists) {
        return new Response('Not found', { status: 404 });
      }

      return stub.fetch(req);
    }

    // Everything else: serve static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

async function handleBoardsApi(req: Request, env: Env, url: URL): Promise<Response> {
  // POST /api/boards — create a new board
  if (req.method === 'POST' && url.pathname === '/api/boards') {
    const visitorKey = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const result = await createBoard(env, visitorKey);
    if (result.ok) {
      return Response.json({ id: result.id }, { status: 201 });
    }
    if (result.reason === 'rate_limited') {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    return Response.json({ error: 'create_failed' }, { status: 500 });
  }

  // GET /api/boards/:id — check existence
  if (req.method === 'GET' && url.pathname.startsWith('/api/boards/')) {
    const id = url.pathname.slice('/api/boards/'.length).split('/')[0];
    if (!isValidBoardId(id)) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const doId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(doId);
    const exists = await stub.exists();
    if (!exists) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    return Response.json({ id }, { status: 200 });
  }

  // Any other method on /api/boards → 405
  return new Response('Method not allowed', { status: 405 });
}

export { BoardRoom };
