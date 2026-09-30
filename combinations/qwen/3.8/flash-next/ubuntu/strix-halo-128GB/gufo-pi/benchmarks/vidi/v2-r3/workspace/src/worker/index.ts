import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  // Test-only flag; NEVER set in production. Enables /__test/* storage hooks.
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Test-only hooks (never enabled in production: TEST_HOOKS is unset there).
    if (env.TEST_HOOKS === '1') {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/__test/')) {
        const { routeTestHook } = await import('./test-hooks');
        const res = await routeTestHook(request, env);
        if (res) return res;
      }
    }

    const url = new URL(request.url);

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch) {
      const boardId = roomMatch[1];

      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }

      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(request);
    }

    // Everything else: static assets (SPA fallback)
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
