import { BoardRoom, type Env } from './board-room';
import { handleTestHooks } from './test-hooks';
import { createBoard } from './create-board';
import { isValidBoardId } from '../shared/board-id';
import { handleUpload, handleServe } from './assets';

export { Env };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Test-only hooks (enabled with TEST_HOOKS=1)
    if (url.pathname.startsWith('/__test/')) {
      const hooksResponse = await handleTestHooks(request, env);
      if (hooksResponse) {
        return hooksResponse;
      }
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', service: 'vidi6' }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Story 5: board creation and existence API.
    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') {
        return jsonError('method_not_allowed', 405);
      }
      const result = await createBoard(env);
      if (result.ok) {
        return new Response(JSON.stringify({ id: result.id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return jsonError('create_failed', 500);
    }

    if (url.pathname.startsWith('/api/boards/')) {
      const rest = url.pathname.substring('/api/boards/'.length);

      // Story 12: POST /api/boards/:id/assets (upload)
      if (rest.endsWith('/assets') && request.method === 'POST') {
        const boardId = rest.substring(0, rest.length - '/assets'.length);
        return handleUpload(request, env, boardId);
      }

      if (request.method !== 'GET') {
        return jsonError('method_not_allowed', 405);
      }
      const boardId = rest;
      // Unknown AND malformed ids both get 404: no distinction, nothing
      // leaked. Malformed ids are rejected here so they never touch the
      // Durable Object namespace at all.
      if (!isValidBoardId(boardId)) {
        return jsonError('not_found', 404);
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      if (!exists) {
        return jsonError('not_found', 404);
      }
      return new Response(JSON.stringify({ id: boardId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Story 12: GET /api/assets/:boardId/:assetId (serve)
    if (url.pathname.startsWith('/api/assets/') && request.method === 'GET') {
      const key = url.pathname.substring('/api/assets/'.length);
      return handleServe(env, key);
    }

    // API routes for rooms
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.substring('/api/rooms/'.length);

      if (!isValidBoardId(boardId)) {
        // Story 5: unknown and malformed ids both get 404 (was 400 in story 3).
        return new Response('Not Found', { status: 404 });
      }

      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);

      return stub.fetch(request);
    }

    // SPA fallback
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export { BoardRoom };
