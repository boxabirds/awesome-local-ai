import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Test hooks (only available when TEST_HOOKS env var is '1')
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      const hookRes = await handleTestHook(request, env, url);
      if (hookRes) return hookRes;
    }

    // Route WebSocket upgrade requests to the BoardRoom Durable Object.
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch) {
      const boardId = roomMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(request);
    }

    // Everything else: static assets.
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
