/**
 * Cloudflare Worker entry point.
 * Story 5 — board creation API, existence check, 404 for unknown boards.
 *
 * Routes:
 * - POST /api/boards → create a new board
 * - GET /api/boards/:id → existence check
 * - PUT /api/boards → 405
 * - /api/rooms/:boardId → BoardRoom Durable Object (WebSocket upgrade)
 * - Everything else → static assets (SPA fallback)
 */
import { isValidBoardId, newBoardId } from '@/shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

/** Worker environment bindings defined in wrangler.jsonc */
export interface WorkerEnv {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

export { BoardRoom };
export { isValidBoardId, newBoardId };

// ── Story 5: Board API handlers ──────────────────────────────────

interface RoomBinding {
  get(id: string): { initialize(): Promise<'created' | 'exists'>; exists(): Promise<boolean> };
  idFromName(name: string): string;
}

async function handleBoardsCollection(
  _url: URL,
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (request.method === 'POST') {
    const result = await createBoard(env as unknown as import('./create-board').Env);
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
  // Only POST and PUT allowed on collection endpoint
  if (request.method === 'PUT') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  // Other methods → 405
  return new Response('Method Not Allowed', { status: 405 });
}

async function handleBoardById(
  boardId: string,
  _url: URL,
  _request: Request,
  env: WorkerEnv,
): Promise<Response> {
  // Only GET is allowed on /api/boards/:id
  if (_request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Validate first — malformed ids never touch storage
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const room = env.BOARD_ROOM.get(
      env.BOARD_ROOM.idFromName(boardId),
    );
    const existsResult = await room.exists();
    if (existsResult) {
      return new Response(JSON.stringify({ id: boardId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    console.error(`Error checking board ${boardId}`);
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── Story 5: /api/boards CRUD ────────────────────────────────

    if (url.pathname === '/api/boards') {
      return handleBoardsCollection(url, request, env);
    }

    const boardsMatch = /^\/api\/boards\/(.+)$/.exec(url.pathname);
    if (boardsMatch) {
      return handleBoardById(boardsMatch[1], url, request, env);
    }

    // Route WebSocket upgrades for rooms
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.replace(/^\/api\/rooms\//, '');

      // Validate board id — story 5: malformed → 404 (not 400)
      if (!isValidBoardId(boardId)) {
        return new Response('Not Found', { status: 404 });
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
