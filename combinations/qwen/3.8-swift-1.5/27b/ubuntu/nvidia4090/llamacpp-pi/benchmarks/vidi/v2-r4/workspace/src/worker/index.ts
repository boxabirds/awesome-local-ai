import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // POST /api/boards - create a new board
    if (url.pathname === '/api/boards') {
      if (req.method === 'POST') {
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
      // Other methods on /api/boards
      return new Response('Method Not Allowed', { status: 405 });
    }

    // GET /api/boards/:id - check board existence
    const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardMatch) {
      if (req.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = boardMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      try {
        const res = await stub.fetch(new Request('http://internal/exists', { method: 'POST' }));
        if (res.status === 200) {
          return new Response(JSON.stringify({ id: boardId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomsMatch) {
      const boardId = roomsMatch[1];

      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
      }

      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }

    // Test hooks (gated by TEST_HOOKS env var)
    if (env.TEST_HOOKS === '1') {
      const initMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/initialize$/);
      if (initMatch && req.method === 'POST') {
        const boardId = initMatch[1];
        const id = env.BOARD_ROOM.idFromName(boardId);
        const stub = env.BOARD_ROOM.get(id);
        await stub.fetch(new Request('http://internal/initialize', { method: 'POST' }));
        return new Response('ok', { status: 200 });
      }
      const corruptMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/corrupt-snapshot$/);
      if (corruptMatch && req.method === 'POST') {
        const boardId = corruptMatch[1];
        const id = env.BOARD_ROOM.idFromName(boardId);
        const stub = env.BOARD_ROOM.get(id);
        return stub.fetch(new Request(req.url, { method: 'POST', headers: { 'x-test-hook': 'corrupt-snapshot' } }));
      }
      const repairMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/repair$/);
      if (repairMatch && req.method === 'POST') {
        const boardId = repairMatch[1];
        const id = env.BOARD_ROOM.idFromName(boardId);
        const stub = env.BOARD_ROOM.get(id);
        return stub.fetch(new Request(req.url, { method: 'POST', headers: { 'x-test-hook': 'repair' } }));
      }
    }

    // Everything else goes to static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom } from './board-room';
