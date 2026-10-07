/**
 * Cloudflare Worker entry point.
 * Story 3 — live collaboration.
 *
 * Routes:
 * - /api/rooms/:boardId → BoardRoom Durable Object (WebSocket upgrade)
 * - Everything else → static assets (SPA fallback)
 */
import { isValidBoardId, newBoardId } from '@/shared/board-id';
import { BoardRoom } from './board-room';

/** Worker environment bindings defined in wrangler.jsonc */
export interface WorkerEnv {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

export { BoardRoom };
export { isValidBoardId, newBoardId };

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route WebSocket upgrades for rooms
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.replace(/^\/api\/rooms\//, '');

      // Validate board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }

      // Require Upgrade header for WebSocket
      const upgradeHeader = request.headers.get('Upgrade') || '';
      if (upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to BoardRoom Durable Object
      const room = env.BOARD_ROOM.get(
        env.BOARD_ROOM.idFromName(boardId),
      );
      return room.fetch(request);
    }

    // All other paths → static assets
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
