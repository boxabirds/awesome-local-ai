import { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomsMatch) {
      const boardId = roomsMatch[1];

      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
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
