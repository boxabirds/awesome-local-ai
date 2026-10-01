import { isValidBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // POST /api/boards – create a new board
    if (url.pathname === '/api/boards') {
      if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }
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

    // GET /api/boards/:id – check board existence
    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch) {
      if (req.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
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
      // Use RPC to call exists()
      const exists = await (stub as any).exists();
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

    // /api/rooms/:id – WebSocket sync
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }
      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(req);
    }
    // Test-only storage corruption/repair endpoints
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/corrupt-board') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-corrupt', { method: 'POST' }));
    }
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/repair-board') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-repair', { method: 'POST' }));
    }
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/fail-next-append') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-fail-append', { method: 'POST' }));
    }
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/fail-next-load') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-fail-load', { method: 'POST' }));
    }
    // Test-only: seed a legacy board (updates rows, no created_at)
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/seed-legacy-board') {
      const boardId = url.searchParams.get('boardId');
      if (!boardId || !isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(new Request('http://internal/test-seed-legacy', { method: 'POST' }));
    }
    // Test-only: make the next createBoard RPC throw
    if (env.TEST_HOOKS === '1' && url.pathname === '/api/test-hooks/fail-next-initialize') {
      // Set a flag on env that createBoard checks
      (env as any).__testFailNextInitialize = '1';
      return new Response('ok');
    }

    return env.ASSETS.fetch(req);
  },
};
