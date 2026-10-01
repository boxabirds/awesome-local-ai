import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleUpload, handleServe } from './assets';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  // Test-only flag; NEVER set in production. Enables /__test/* storage hooks.
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Test-only hooks (never enabled in production: TEST_HOOKS is unset there).
    if (env.TEST_HOOKS === '1') {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/__test/')) {
        const { routeTestHook } = await import('./test-hooks');
        const res = await routeTestHook(request, env);
        if (res) return res;
      }
    }

    const url = new URL(request.url);

    // Route /api/boards — create a board (POST) or check existence (GET /api/boards/:id)
    if (url.pathname === '/api/boards') {
      if (request.method === 'POST') {
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
      return new Response('Method Not Allowed', { status: 405 });
    }

    // GET /api/boards/:id — existence check
    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch) {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = boardMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      const exists = await (stub as unknown as BoardRoom).exists();
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
    }

    // Route POST /api/boards/:id/assets — upload image asset
    const uploadMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/assets$/);
    if (uploadMatch) {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = uploadMatch[1];
      return handleUpload(request, env, boardId);
    }

    // Route GET /api/assets/:boardId/:assetId — serve image asset
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
    if (assetMatch) {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const key = `${assetMatch[1]}/${assetMatch[2]}`;
      return handleServe(env, key);
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch) {
      const boardId = roomMatch[1];

      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(request);
    }

    // Everything else: static assets (SPA fallback)
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
