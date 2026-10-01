import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
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

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);

    if (match) {
      const boardId = match[1]!;

      // Validate board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
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
