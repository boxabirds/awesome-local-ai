import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook } from './test-hooks';
import { handleUpload, handleServe } from './assets';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Test hooks (only available when TEST_HOOKS env var is '1')
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      const hookRes = await handleTestHook(request, env, url);
      if (hookRes) return hookRes;
    }

    // POST /api/boards — create a new board
    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const result = await createBoard(env);
      if (result.ok) {
        return new Response(JSON.stringify({ id: result.id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /api/boards/:id — check existence
    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch) {
      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const boardId = boardMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      const exists = await (stub as unknown as { exists(): Promise<boolean> }).exists();
      if (!exists) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: boardId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /api/boards/:id/assets — upload an image
    const uploadMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/assets$/);
    if (uploadMatch) {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      const boardId = decodeURIComponent(uploadMatch[1]!);
      return handleUpload(request, env, boardId);
    }

    // GET /api/assets/:boardId/:assetId — serve a stored image
    const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
    if (assetMatch) {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }
      const key = `${decodeURIComponent(assetMatch[1]!)}/${decodeURIComponent(assetMatch[2]!)}`;
      return handleServe(env, key);
    }

    // Route WebSocket upgrade requests to the BoardRoom Durable Object.
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch) {
      const boardId = roomMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(request);
    }

    // Everything else: static assets.
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
