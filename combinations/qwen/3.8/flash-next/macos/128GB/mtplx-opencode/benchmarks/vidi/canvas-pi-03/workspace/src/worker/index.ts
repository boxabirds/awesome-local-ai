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
  /** Test-only: enables the room's storage-inspection / damage hooks. Set ONLY
   * in the `test` wrangler environment and in `npm run workers:test`; the
   * production config never defines it, and then these paths are plain asset
   * requests (verified by tests/e2e/production-hooks.spec.ts). */
  TEST_HOOKS?: string;
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
    return workerFetch(request, env);
  },
};

export async function workerFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Test hooks (never enabled in production): /__test/rooms/<id>/<op> is
  // forwarded to that board's object with the path rewritten to /<op>, so the
  // fixture tooling can damage and inspect ONE board's storage (and the
  // e2e tests can prove that without the flag nothing is reachable).
  if (url.pathname.startsWith('/__test/rooms/') && env.TEST_HOOKS === '1') {
    const rest = url.pathname.slice('/__test/rooms/'.length);
    const slash = rest.indexOf('/');
    const boardId = slash === -1 ? rest : rest.slice(0, slash);
    const hookPath = slash === -1 ? '' : rest.slice(slash + 1);
    if (isValidBoardId(boardId) && hookPath.length > 0) {
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      // The path keeps its /__test/ prefix: the room recognises hook paths by
      // that prefix and dispatches on the last segment.
      const forwarded = new Request(`https://room.internal${url.pathname}${url.search}`, request);
      return stub.fetch(forwarded);
    }
    return new Response('Not found', { status: 404 });
  }

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
    // SPA fallback for deep links like /b/<boardId> (and for /__test/... paths
    // in a build where the hooks are off: they reach the SPA, never a room).
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), { headers: request.headers }));
  }
  return response;
}