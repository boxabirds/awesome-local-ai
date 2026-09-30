import { BoardRoom, type Env } from './board-room';
import { handleTestHooks } from './test-hooks';
import { isValidBoardId } from '../shared/board-id';

export { Env };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Test-only hooks (enabled with TEST_HOOKS=1)
    if (url.pathname.startsWith('/__test/')) {
      const hooksResponse = await handleTestHooks(request, env);
      if (hooksResponse) return hooksResponse;
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // API routes for rooms
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.substring('/api/rooms/'.length);

      // Validate board id before anything else
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board ID', { status: 400 });
      }

      // Require WebSocket upgrade
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Route to the Durable Object for this board
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(request);
    }

    // SPA fallback: serve client assets
    try {
      const assetsResponse = await env.ASSETS.fetch(request);
      if (assetsResponse.status !== 404) {
        return assetsResponse;
      }
    } catch {
      // fall through to 404
    }

    // Check if this looks like a board URL (/b/<id>)
    const boardMatch = url.pathname.match(/^\/b\/([a-zA-Z0-9-]+)$/);
    if (boardMatch) {
      const boardId = boardMatch[1];
      if (isValidBoardId(boardId)) {
        // Serve the SPA entry point
        const indexResponse = await env.ASSETS.fetch(
          new Request(new URL('/index.html', url.origin).href, request)
        );
        return indexResponse;
      }
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
