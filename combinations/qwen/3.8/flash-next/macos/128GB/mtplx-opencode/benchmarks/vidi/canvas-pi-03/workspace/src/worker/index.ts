// Worker entry (sync.worker_entry + share.board_api).
//
// Routing:
//   /api/boards            → POST create, other methods 405
//   /api/boards/:id        → GET existence check (404 unknown + malformed)
//   /api/rooms/:boardId    → the BoardRoom Durable Object for that board
//   everything else        → static assets (with an index.html fallback so
//                            /b/<boardId> deep links reach the SPA).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Workers rate-limit binding (share.rate_limit). limit/period mirror the
   * BOARD_CREATE_LIMIT / BOARD_CREATE_PERIOD_SECONDS settings (TC-03). May be
   * absent in the local test runtime; createBoard then skips limiting. */
  BOARD_CREATE_LIMITER?: {
    limit(opts: { key: string }): Promise<{ success: boolean }>;
  };
  /** Test-only: enables the room's storage-inspection / damage hooks. Set ONLY
   * in the `test` wrangler environment and in `npm run workers:test`; the
   * production config never defines it, and then these paths are plain asset
   * requests (verified by tests/e2e/production-hooks.spec.ts). */
  TEST_HOOKS?: string;
}

/** The shared-room route prefix. `/api/rooms` itself (no id) is invalid. */
const ROOM_ROUTE = '/api/rooms';
/** The board-collection route (POST create) and the per-board check route. */
const BOARDS_ROUTE = '/api/boards';

function notFound(message = 'Not found'): Response {
  return new Response(message, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

/** A limiter that always allows: only reachable through the test-only header. */
const ALWAYS_ALLOWED = { limit: async () => ({ success: true }) };

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

  // --- Board API (share.board_api) ------------------------------------------

  if (url.pathname === BOARDS_ROUTE) {
    // POST /api/boards → create a board. Any other method → 405 (TC-14).
    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const visitorKey = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const result = await createBoard(env, visitorKey, {
      // Only the test environment may step over the limiter, and only through
      // the explicit header: fixtures must not be throttled into 429s (the
      // local runtime enforces the real binding, and every local request shares
      // one key). tests/integration/board-api.test.ts covers the limiter with
      // the header left off.
      limiter: env.TEST_HOOKS === '1' && request.headers.get('x-test-ignore-limit') === '1' ? ALWAYS_ALLOWED : undefined,
    });
    if (result.ok) return json({ id: result.id }, 201);
    if (result.reason === 'rate_limited') return json({ error: 'rate_limited' }, 429);
    return json({ error: 'create_failed' }, 500);
  }

  if (url.pathname.startsWith(`${BOARDS_ROUTE}/`)) {
    // GET /api/boards/:id → 200 exists / 404 unknown or malformed. A malformed
    // id never touches the Durable Object namespace (TC-07).
    const raw = url.pathname.slice(BOARDS_ROUTE.length + 1);
    if (raw.includes('/') || !isValidBoardId(raw)) return notFound();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(raw));
    const exists = await (stub as unknown as { exists(): Promise<boolean> }).exists();
    return exists ? json({ id: raw }, 200) : notFound();
  }

  // --- Room WebSocket route -------------------------------------------------

  if (url.pathname === ROOM_ROUTE || url.pathname.startsWith(`${ROOM_ROUTE}/`)) {
    const boardId = readBoardId(url.pathname);
    // Malformed (or missing) board id → 404 (was 400 in story 3). No Durable
    // Object instance is ever touched, and unknown/malformed ids leak nothing.
    if (boardId === null || !isValidBoardId(boardId)) return notFound('Invalid board id');
    // Valid id without the upgrade header → 426 (TC-05).
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', {
        status: 426,
        headers: { 'content-type': 'text/plain; charset=utf-8', upgrade: 'websocket' },
      });
    }
    // One object per board id: `idFromName` is what isolates boards (TC-17).
    // The room rejects a NON-EXISTENT board with 404 before accepting, so
    // story 3/4 rooms can no longer be created implicitly by connecting.
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