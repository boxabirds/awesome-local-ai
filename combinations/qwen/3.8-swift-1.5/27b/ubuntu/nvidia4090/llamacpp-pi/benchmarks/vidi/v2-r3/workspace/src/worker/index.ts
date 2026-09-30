import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleTestHooks } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test hooks (only active when TEST_HOOKS === '1')
    const testHookResponse = await handleTestHooks(req, env as unknown as { BOARD_ROOM: DurableObjectNamespace; TEST_HOOKS?: string });
    if (testHookResponse) return testHookResponse;

    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      const isWebSocket =
        (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
      if (!isWebSocket) {
        return new Response('Upgrade Required', { status: 426 });
      }

      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
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
