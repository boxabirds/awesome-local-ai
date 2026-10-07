import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
export { BoardRoom } from './board-room';
export { isValidBoardId, newBoardId };

const BOARD_ROOM = 'BOARD_ROOM' as unknown as string;

// Minimal runtime env type for the worker
type RuntimeEnv = {
  BOARD_ROOM: RoomNamespace;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

interface RoomNamespace {
  get(name: string): RoomStub;
  idFromName(name: string): string;
}

interface RoomStub {
  initialize(): Promise<'created' | 'exists'>;
  exists(): boolean;
  fetch(request: Request): Promise<Response>;
}

export default {
  async fetch(
    request: Request,
    env: RuntimeEnv,
    _ctx: { waitUntil: (p: Promise<void>) => void },
  ): Promise<Response> {
    const url = new URL(request.url);

    // ---------- Board API routes ----------

    // POST /api/boards — create a new board
    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const result = await createBoard({
        BOARD_ROOM: env.BOARD_ROOM,
      } as unknown as {
        BOARD_ROOM: {
          get(name: string): { initialize(): Promise<'created' | 'exists'>; exists(): boolean };
          idFromName(name: string): string;
        };
      });
      if (result.ok) {
        return new Response(JSON.stringify({ id: result.id }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'create_failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /api/boards/:id — existence check
    const boardsMatch = url.pathname.match(/^\/api\/boards\/(.+)$/);
    if (boardsMatch) {
      const id = decodeURIComponent(boardsMatch[1]);
      if (!isValidBoardId(id)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      try {
        const namespace = env.BOARD_ROOM!;
        const roomId = namespace.idFromName(id);
        const room = namespace.get(roomId);
        const exists = await room.exists();
        if (exists) {
          return new Response(JSON.stringify({ id }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (_e: unknown) {
        console.error({ msg: 'board-api.get-failed', error: _e });
        return new Response(JSON.stringify({ error: 'internal_error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ---------- WebSocket upgrade routes ----------

    // Route WebSocket upgrades to /api/rooms/:boardId
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found — invalid board id', { status: 404 });
      }
      if (!request.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
        return new Response(
          'Upgrade Required — WebSocket connection expected',
          { status: 426 },
        );
      }
      const room = env.BOARD_ROOM!.get(env.BOARD_ROOM!.idFromName(boardId));
      return room.fetch(request);
    }

    // ---------- Static files (ASSETS or inline serve) ----------

    // Try assets binding first
    if (env.ASSETS) {
      try {
        return await env.ASSETS.fetch(request);
      } catch {
        // Fall through
      }
    }

    // Inline serve for development without ASSETS
    let path = url.pathname;
    if (path === '/' || path === '') path = '/index.html';

    // SPA fallback: serve index.html for non-API, non-file paths
    if (!path.includes('.')) {
      // Check if it's a known API route that should 404
      if (path.startsWith('/api/')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('<html><body>Error: no assets</body></html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
