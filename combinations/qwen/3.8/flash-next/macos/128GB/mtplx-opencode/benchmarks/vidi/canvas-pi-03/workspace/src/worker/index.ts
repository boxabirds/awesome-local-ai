// Worker entry (sync.worker_entry).
//
// Routing:
//   /api/rooms/:boardId  → the BoardRoom Durable Object for that board
//   everything else      → static assets (with an index.html fallback so
//                          /b/<boardId> deep links reach the SPA even when
//                          the assets layer answers a bare 404).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

/** The shared-room route prefix. `/api/rooms` itself (no id) is invalid. */
const ROOM_ROUTE = '/api/rooms';

function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function upgradeRequired(): Response {
  return new Response('Upgrade Required', {
    status: 426,
    headers: { 'content-type': 'text/plain; charset=utf-8', upgrade: 'websocket' },
  });
}

function readBoardId(pathname: string): string | null {
  if (!pathname.startsWith(`${ROOM_ROUTE}/`)) return '';
  const segment = pathname.slice(ROOM_ROUTE.length + 1);
  if (segment.includes('/')) return null; // e.g. /api/rooms/a/b — not one id
  try {
    return decodeURIComponent(segment);
  } catch {
    return null; // malformed percent-escape
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === ROOM_ROUTE || url.pathname.startsWith(`${ROOM_ROUTE}/`)) {
      const boardId = readBoardId(url.pathname);
      // Invalid (or missing) board id → 400, and critically: no Durable
      // Object instance is ever touched (TC-04).
      if (boardId === null || !isValidBoardId(boardId)) return badRequest('Invalid board id');
      // Valid id without the upgrade header → 426 (TC-05).
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return upgradeRequired();
      // One object per board id: `idFromName` is what isolates boards (TC-17).
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    // Everything else is static assets.
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.method === 'GET') {
      // SPA fallback for deep links like /b/<boardId>. The assets layer may
      // already answer these with index.html (not_found_handling); this
      // guarantees it either way.
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), { headers: request.headers }));
    }
    return response;
  },
};