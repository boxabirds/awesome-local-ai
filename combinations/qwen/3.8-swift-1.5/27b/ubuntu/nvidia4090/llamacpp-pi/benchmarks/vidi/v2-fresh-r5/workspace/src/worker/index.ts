import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHooks } from './test-hooks';
import { isValidBoardId } from '../shared/board-id';

// Exported (not just imported) so the vitest workers pool can resolve the
// Durable Object class from the main module in integration tests.
export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Set to "1" in test environments only; enables the /__test/ routes. */
  TEST_HOOKS?: string;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test-only storage hooks (corrupt/repair/seed a board's storage).
    // Compiled into behaviour only when TEST_HOOKS is "1" — never set in
    // production config.
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      return handleTestHooks(request, env, url);
    }

    // POST /api/boards — create a board (story 5).
    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') {
        return json(405, { error: 'method_not_allowed' });
      }
      const result = await createBoard(env);
      if (result.ok) return json(201, { id: result.id });
      return json(500, { error: 'create_failed' });
    }

    // GET /api/boards/:id — existence check (story 5). Unknown AND malformed
    // ids are indistinguishable 404s (nothing leaked); malformed ids never
    // touch the Durable Object namespace.
    if (url.pathname.startsWith('/api/boards/')) {
      const boardId = url.pathname.slice('/api/boards/'.length);
      if (request.method !== 'GET' || !isValidBoardId(boardId)) {
        return json(404, { error: 'not_found' });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      return exists ? json(200, { id: boardId }) : json(404, { error: 'not_found' });
    }

    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);
      // Unknown and malformed ids are both 404 (story 5; story 3 used 400
      // for malformed).
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Board not found', { status: 404 });
      }
      // The room endpoint is a WebSocket upgrade endpoint only.
      const upgrade = request.headers.get('Upgrade');
      if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
