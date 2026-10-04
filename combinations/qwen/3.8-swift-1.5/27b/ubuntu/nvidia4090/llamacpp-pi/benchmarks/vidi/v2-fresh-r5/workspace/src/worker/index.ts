import { BoardRoom } from './board-room';
import { handleTestHooks } from './test-hooks';
import { isValidBoardId } from '../shared/board-id';

// Exported (not just imported) so the vitest workers pool can resolve the
// Durable Object class from the main module in integration tests.
export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Set to "1" in test environments only; enables the /__test/ routes. */
  TEST_HOOKS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test-only storage hooks (corrupt/repair a board's snapshot). Compiled
    // into behaviour only when TEST_HOOKS is "1" — never set in production
    // config.
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      return handleTestHooks(request, env, url);
    }

    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);
      if (!boardId) {
        return new Response('Missing board id', { status: 400 });
      }
      // Validate before looking up (or creating) any object instance.
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      // The room endpoint is a WebSocket upgrade endpoint only.
      const upgrade = request.headers.get('Upgrade');
      if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
