import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestRoute } from './test-hooks';
import { handleUpload, handleServe } from './assets';
import type { Env } from './env';

const ROOM_PREFIX = '/api/rooms/';
const BOARDS_PREFIX = '/api/boards';
const ASSETS_SERVE_PREFIX = '/api/assets/';
const TEST_PREFIX = '/api/test/';

/**
 * Worker entry. Routes:
 *   POST /api/boards              → create a new board
 *   GET  /api/boards/:id          → check board existence
 *   POST /api/boards/:id/assets   → upload an image asset
 *   GET  /api/assets/:boardId/:assetId → serve an image asset
 *   /api/rooms/:id                → WebSocket to that board's Durable Object
 *   everything else               → static SPA assets
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test hooks (only in test mode)
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith(TEST_PREFIX)) {
      const res = await handleTestRoute(request, env, url);
      if (res) return res;
    }

    // POST /api/boards — create a board
    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      const visitorKey = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
      const result = await createBoard(env, visitorKey);
      if (result.ok) {
        return Response.json({ id: result.id }, { status: 201 });
      }
      if (result.reason === 'rate_limited') {
        return Response.json({ error: 'rate_limited' }, { status: 429 });
      }
      return Response.json({ error: 'create_failed' }, { status: 500 });
    }

    // POST /api/boards/:id/assets — upload image asset
    if (
      url.pathname.startsWith(BOARDS_PREFIX + '/') &&
      url.pathname.endsWith('/assets') &&
      request.method === 'POST'
    ) {
      const rest = url.pathname.slice(BOARDS_PREFIX.length + 1, -'/assets'.length);
      const boardId = decodeURIComponent(rest);
      return handleUpload(request, env, boardId);
    }

    // GET /api/boards/:id — check existence
    if (url.pathname.startsWith(BOARDS_PREFIX + '/')) {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      const boardId = decodeURIComponent(url.pathname.slice(BOARDS_PREFIX.length + 1));
      if (!isValidBoardId(boardId)) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      const exists = await stub.exists();
      if (!exists) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      return Response.json({ id: boardId }, { status: 200 });
    }

    // GET /api/assets/:boardId/:assetId — serve an image
    if (url.pathname.startsWith(ASSETS_SERVE_PREFIX)) {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      const key = url.pathname.slice(ASSETS_SERVE_PREFIX.length);
      return handleServe(env, key);
    }

    if (url.pathname.startsWith(ROOM_PREFIX)) {
      const boardId = decodeURIComponent(url.pathname.slice(ROOM_PREFIX.length));
      // Reject bad ids *before* touching the namespace: no object instance is
      // created for an invalid id.
      if (!isValidBoardId(boardId)) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else (including /b/<boardId> via single-page-application
    // not_found_handling) is served by the static assets binding.
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
export type { Env };
