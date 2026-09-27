// Worker entry point. Routing (stories 3-5):
//   POST /api/boards          create a board (rate limited, 201 {id} | 429 | 500)
//   GET  /api/boards/:id      existence check for a link (200 | 404)
//   GET  /api/rooms/:id       WebSocket room for a board (101 upgrade | 404 | 426)
//   <anything else>           static assets (SPA fallback to index.html)
// Malformed ids never reach the namespace: they are answered here with 404.

import { isValidBoardId } from '../shared/board-id';
import { createBoard, visitorKey } from './create-board';
import { handleTestHook } from './test-hooks';
import type { Env } from './env';

const BOARD_API_RE = /^\/api\/boards\/([^/]*)\/?$/;
const ROOM_API_RE = /^\/api\/rooms\/([^/]*)\/?$/;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/boards') {
      if (request.method !== 'POST') return jsonError(405, 'method_not_allowed');
      try {
        const result = await createBoard(env, visitorKey(request));
        if (result.ok) return Response.json({ id: result.id }, { status: 201 });
        if (result.reason === 'rate_limited') return jsonError(429, 'rate_limited');
        return jsonError(500, 'create_failed');
      } catch (e) {
        console.error(JSON.stringify({ event: 'create-board-failed', error: e instanceof Error ? e.message : String(e) }));
        return jsonError(500, 'create_failed');
      }
    }

    const boardMatch = BOARD_API_RE.exec(path);
    if (boardMatch) {
      if (request.method !== 'GET') return jsonError(405, 'method_not_allowed');
      let id = boardMatch[1]!;
      try {
        id = decodeURIComponent(id);
      } catch {
        return jsonError(404, 'not_found');
      }
      if (!isValidBoardId(id)) return jsonError(404, 'not_found'); // never touched the namespace
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
      const exists = await stub.exists();
      return exists ? Response.json({ id }) : jsonError(404, 'not_found');
    }

    const roomMatch = ROOM_API_RE.exec(path);
    if (roomMatch) {
      let id = roomMatch[1]!;
      try {
        id = decodeURIComponent(id);
      } catch {
        return jsonError(404, 'not_found');
      }
      if (!isValidBoardId(id)) return jsonError(404, 'not_found');
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return jsonError(426, 'upgrade_required');
      }
      // BoardRoom answers 404 (no upgrade, no socket) when the board does not exist.
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).fetch(request);
    }

    const hookResponse = await handleTestHook(request, env, path);
    if (hookResponse) return hookResponse;

    // Unknown /api/* paths are 404s, never the SPA document: an app that follows
    // a broken board link must see "not_found", not index.html.
    if (path === '/api' || path.startsWith('/api/')) return jsonError(404, 'not_found');

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom } from './board-room';
