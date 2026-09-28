/**
 * Story 5: Worker entry point.
 *
 * Routes:
 *   POST /api/boards         → create a board (rate-limited; 201/429/500)
 *   GET  /api/boards/:id     → board existence (200/404; read-only, no writes)
 *   GET  /api/rooms/:id      → WebSocket upgrade to the board's BoardRoom
 *                              (404 for unknown or malformed ids; 426 without
 *                              the Upgrade header)
 *   everything else          → static assets (single-page-app fallback)
 *
 * Board isolation comes from `idFromName(boardId)` giving each board its own
 * Durable Object instance. Ids are validated with `isValidBoardId` BEFORE any
 * namespace access, so malformed ids never instantiate a Durable Object and
 * probing a link never writes storage.
 */
import { isValidBoardId } from 'src/shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Production: the platform rate-limiter binding (wrangler.jsonc). */
  BOARD_CREATE_LIMITER?: RateLimit;
  /** '1' in test/e2e environments only; enables the /__test/ ops routes. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PREFIX = '/api/boards';
const TEST_PREFIX = '/__test/boards/';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith(TEST_PREFIX)) {
      // Route a test op to the board's Durable Object; it runs the op against
      // its storage and returns JSON. Never enabled in production config.
      const boardId = url.pathname.slice(TEST_PREFIX.length).split('/')[0];
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }
    if (url.pathname === BOARDS_PREFIX || url.pathname.startsWith(BOARDS_PREFIX + '/')) {
      if (req.method === 'POST' && url.pathname === BOARDS_PREFIX) {
        const visitorKey = req.headers.get('CF-Connecting-IP') ?? 'unknown';
        const result = await createBoard(env, visitorKey);
        if (result.ok) return json({ id: result.id }, 201);
        if (result.reason === 'rate_limited') return json({ error: 'rate_limited' }, 429);
        return json({ error: 'create_failed' }, 500);
      }
      if (req.method === 'GET' && url.pathname !== BOARDS_PREFIX) {
        const boardId = url.pathname.slice(BOARDS_PREFIX.length + 1).split('/')[0] ?? '';
        // Unknown and malformed ids are indistinguishable: 404, no namespace
        // access for malformed ids, nothing written (share.not_found).
        if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
        const exists = await stub.exists();
        return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
      }
      return json({ error: 'method_not_allowed' }, 405);
    }
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length).split('/')[0] ?? '';
      // Story 5: malformed ids no longer reach the room object; 404 (was 400).
      if (!isValidBoardId(boardId)) {
        return json({ error: 'not_found' }, 404);
      }
      const upgrade = (req.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', {
          status: 426,
          headers: { Upgrade: 'websocket' },
        });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
