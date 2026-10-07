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

    // Route __test/* → BoardRoom with a synthetic board id
    if (url.pathname.startsWith('/__test/store/') || url.pathname.startsWith('/api/storage/')) {
      let storageId: string | null = null;
      if (url.pathname.startsWith('/__test/store/')) {
        const parts = url.pathname.split('/');
        storageId = parts[3];
      } else if (url.pathname.startsWith('/api/storage/')) {
        // Alias: /api/storage/{boardId}/__test/store/{alias}/{action}
        const parts = url.pathname.split('/');
        if (parts.length >= 6) {
          storageId = parts[3]; // Use the boardId as DO instance key
        }
      }
      if (storageId) {
        const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(storageId));
        const rewritten = new Request(`http://localhost${url.pathname}`, request);
        return room.fetch(rewritten);
      }
    }

    // All other paths → static assets
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
