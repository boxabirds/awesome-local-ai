import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Validate the board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }

      // Check for WebSocket upgrade header
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const roomStub = env.BOARD_ROOM.get(doId);
      return roomStub.fetch(request);
    }

    // Test hooks (only available when TEST_HOOKS=1 in the environment)
    const testHookResponse = await handleTestHook(request, env);
    if (testHookResponse) return testHookResponse;

    // Everything else: serve static assets (SPA fallback handled by wrangler config)
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
