import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

type Env = {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** When '1', exposes the test-only /test/corrupt and /test/repair hooks. Never set in production. */
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // POST /api/boards — create a new board
    if (url.pathname === '/api/boards') {
      if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json', 'allow': 'POST' },
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

    // GET /api/boards/:id — check if a board exists
    const boardsMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (boardsMatch) {
      if (req.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { 'content-type': 'application/json', 'allow': 'GET' },
        });
      }
      const boardId = boardsMatch[1];
      // Validate board id: malformed → 404 (no distinction from unknown, nothing leaked)
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Check existence via RPC
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      const exists = await (stub as unknown as { exists(): Promise<boolean> }).exists();
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

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomsMatch) {
      const boardId = roomsMatch[1];

      // Validate board id: malformed → 404 (was 400 in story 3)
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
      }

      // Require WebSocket upgrade
      const upgrade = req.headers.get('upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      const resp = await stub.fetch(req);
      return resp;
    }

    // Test-only storage corruption/repair hooks (never enabled in production).
    if (env.TEST_HOOKS === '1') {
      const testMatch = url.pathname.match(/^\/test\/(corrupt|repair)$/);
      if (testMatch) {
        const action = testMatch[1];
        const boardId = url.searchParams.get('board');
        if (!boardId || !isValidBoardId(boardId)) {
          return new Response('Bad Request', { status: 400 });
        }
        const id = env.BOARD_ROOM.idFromName(boardId);
        const stub = env.BOARD_ROOM.get(id) as unknown as {
          corruptSnapshotForTest(): Promise<void>;
          repairSnapshotForTest(): Promise<void>;
        };
        if (action === 'corrupt') {
          await stub.corruptSnapshotForTest();
        } else {
          await stub.repairSnapshotForTest();
        }
        return new Response(JSON.stringify({ ok: true, action, boardId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      // Test-only: seed a legacy board (updates rows without created_at)
      const seedMatch = url.pathname.match(/^\/test\/seed-legacy$/);
      if (seedMatch) {
        const boardId = url.searchParams.get('board');
        if (!boardId || !isValidBoardId(boardId)) {
          return new Response('Bad Request', { status: 400 });
        }
        const dataParam = url.searchParams.get('data');
        if (!dataParam) {
          return new Response('Bad Request: missing data param', { status: 400 });
        }
        // Decode base64 data
        const binary = atob(dataParam);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const id = env.BOARD_ROOM.idFromName(boardId);
        const stub = env.BOARD_ROOM.get(id) as unknown as {
          seedLegacyForTest(data: ArrayBuffer): Promise<void>;
        };
        await stub.seedLegacyForTest(bytes.slice().buffer as ArrayBuffer);
        return new Response(JSON.stringify({ ok: true, boardId }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    // Everything else → static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
