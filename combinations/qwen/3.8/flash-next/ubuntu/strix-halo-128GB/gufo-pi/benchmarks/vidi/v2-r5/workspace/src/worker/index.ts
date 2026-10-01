import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test hook routes (only active when env.TEST_HOOKS === '1')
    const hookRes = await handleTestHook(request, env, url);
    if (hookRes) return hookRes;

    // POST /api/boards — create a new board
    if (url.pathname === '/api/boards') {
      if (request.method === 'POST') {
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
      // Other methods on /api/boards → 405
      return new Response('Method Not Allowed', { status: 405 });
    }

    // GET /api/boards/:id — check board existence
    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch) {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = boardMatch[1]!;

      // Malformed ids → 404 without touching the namespace
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const docId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(docId);
      const exists = await stub.exists();
      if (exists) {
        return new Response(JSON.stringify({ id: boardId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket rooms
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match) {
      const boardId = match[1]!;

      // Validate board id: malformed → 404 (was 400 in story 3)
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
      }

      // Check for WebSocket upgrade header
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Route to the Durable Object
      const docId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(docId);
      return stub.fetch(request);
    }

    // Everything else: serve static assets
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
