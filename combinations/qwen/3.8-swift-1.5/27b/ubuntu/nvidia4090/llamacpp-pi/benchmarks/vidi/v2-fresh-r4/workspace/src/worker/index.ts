import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

type Env = {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** When '1', exposes the test-only /test/corrupt and /test/repair hooks. Never set in production. */
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomsMatch) {
      const boardId = roomsMatch[1];

      // Validate board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      // Require WebSocket upgrade
      const upgrade = req.headers.get('upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      console.log('[Worker] routing WS to DO', boardId);
      const resp = await stub.fetch(req);
      console.log('[Worker] DO responded', boardId, resp.status);
      return resp;
    }

    // Test-only storage corruption/repair hooks (never enabled in production).
    // TC-24 drives a real load failure and recovery through these endpoints.
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
    }

    // Everything else → static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
