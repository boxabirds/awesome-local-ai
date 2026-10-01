import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleCreateBoardRequest } from './create-board';
import { handleTestHooks } from './test-hooks';
import { handleUpload, handleServe } from './assets';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  TEST_HOOKS?: string;
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', { status: 405 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test hooks (only active when TEST_HOOKS === '1')
    const testHookResponse = await handleTestHooks(req, env as unknown as { BOARD_ROOM: DurableObjectNamespace; TEST_HOOKS?: string });
    if (testHookResponse) return testHookResponse;

    // Board API (story 5)
    if (url.pathname === '/api/boards') {
      if (req.method === 'POST') {
        return handleCreateBoardRequest(env);
      }
      return methodNotAllowed();
    }

    if (url.pathname.startsWith('/api/boards/')) {
      const boardId = url.pathname.slice('/api/boards/'.length);

      // Story 12: POST /api/boards/:id/assets (image upload)
      if (boardId.endsWith('/assets') && req.method === 'POST') {
        const id = boardId.slice(0, -'/assets'.length);
        return handleUpload(req, env, id);
      }

      if (req.method !== 'GET') {
        return methodNotAllowed();
      }
      // Malformed ids get the same 404 as unknown ids: nothing is leaked and
      // the Durable Object namespace is never touched (TC-07).
      if (!isValidBoardId(boardId)) {
        return notFound();
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      const exists = await stub.exists();
      if (exists) {
        return new Response(JSON.stringify({ id: boardId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return notFound();
    }

    // Story 12: GET /api/assets/:boardId/:assetId (serve stored image)
    if (url.pathname.startsWith('/api/assets/') && req.method === 'GET') {
      const key = url.pathname.slice('/api/assets/'.length);
      return handleServe(env, key);
    }

    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Story 3's 400 for malformed ids becomes 404 (share.board_api):
      // malformed ids never instantiate a Durable Object.
      if (!isValidBoardId(boardId)) {
        return notFound();
      }

      const isWebSocket =
        (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
      if (!isWebSocket) {
        return new Response('Upgrade Required', { status: 426 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      // The room's fetch returns 404 for boards that do not exist.
      return stub.fetch(req);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    // Fallback for test environments without assets binding
    return new Response('<html><head><title>vidi6</title></head><body></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

export { BoardRoom };
