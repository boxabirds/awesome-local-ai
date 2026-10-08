/** Worker entry point for stories 3–5 — persistent boards, creation & sharing */

import { isValidBoardId } from '@shared/board-id';
import { createBoard } from './create-board';
export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// Serve static assets helper
async function serveAssets(url: URL, env: Env): Promise<Response> {
  try {
    return await (env.ASSETS as any).fetch(url);
  } catch {
    // Fallback for when assets are not available
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── Board API: POST /api/boards (create a new board) ───────────
    if (url.pathname === '/api/boards' && request.method === 'POST') {
      const result = await createBoard(env);
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

    // ── Board API: reject non-POST on /api/boards → 405 ────────────
    if (url.pathname === '/api/boards') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Board existence check: GET /api/boards/:id ─────────────────
    const matchBoardGet = url.pathname.match(/^\/api\/boards\/(.+)$/);
    if (matchBoardGet) {
      const boardId = decodeURIComponent(matchBoardGet[1]);

      // Malformed ids never reach the DO
      if (!isValidBoardId(boardId)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const roomId = env.BOARD_ROOM.idFromName(boardId);
      const room = env.BOARD_ROOM.get(roomId);

      try {
        // Cast to any since DurableObjectStub types don't include our custom methods
        const exists = await (room as any).exists();
        if (exists) {
          return new Response(JSON.stringify({ id: boardId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Route /api/rooms/* to the BoardRoom ────────────────────────
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardIdPath = url.pathname.split('?')[0].slice('/api/rooms/'.length);

      // Validate board id — malformed now returns 404 (was 400)
      if (!isValidBoardId(boardIdPath)) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const roomId = env.BOARD_ROOM.idFromName(boardIdPath);
      const room = env.BOARD_ROOM.get(roomId);

      return room.fetch(request);
    }

    // ── All other routes — serve static assets (SPA fallback) ──────
    return serveAssets(url, env);
  },
};
