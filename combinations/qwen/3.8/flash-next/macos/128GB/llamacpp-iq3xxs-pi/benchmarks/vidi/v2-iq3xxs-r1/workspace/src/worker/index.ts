import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

/**
 * Bindings configured in `wrangler.jsonc`: the room namespace (one Durable
 * Object per board) and the built client.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** `'1'` turns on the `/__test/boards/...` damage routes. Absent in production. */
  TEST_HOOKS?: string;
}

/** `/api/rooms/:boardId` — the one path the Worker handles itself. */
const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

/**
 * The test-only storage-damage routes, e.g.
 * `POST /__test/boards/:boardId/corrupt-snapshot` and `/repair-snapshot`. They exist
 * only so a browser test can drive a real board into an unreadable state and back
 * (TC-24). The whole route is registered only when `env.TEST_HOOKS === '1'`, which is
 * set only in the e2e wrangler environment — never in the production config, where
 * these paths fall through to the SPA fallback.
 */
const TEST_HOOK_PATH =
  /^\/__(?:test|diag)\/boards\/([^/]+)\/(corrupt-snapshot|repair-snapshot|board-summary)$/;

/**
 * Requests that are not a room connection are static assets, so `/`, `/b/<id>`
 * and every other client route fall through to the SPA fallback configured in
 * `wrangler.jsonc`.
 *
 * Boards stay separate (PRD live.isolation) because `idFromName(boardId)` routes
 * each board to its own object, which only knows its own sockets and its own
 * document.
 *
 * Nothing here counts participants, so the 6th person on a board is accepted
 * like anyone else (PRD live.over_capacity): `MAX_CONCURRENT_EDITORS` is a
 * design and test target, never enforced.
 */
async function routeRoom(request: Request, env: Env): Promise<Response | null> {
  const match = ROOM_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;

  const boardId = decodeURIComponent(match[1]!);
  if (!isValidBoardId(boardId)) {
    return new Response('invalid board id', { status: 400 });
  }
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected a websocket connection', { status: 426 });
  }

  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return room.fetch(request);
}

/**
 * Handle a test-hook request, or return null if hooks are off or the path is not a
 * hook. Registered before the asset fallthrough and gated on `TEST_HOOKS` so the
 * production build simply does not expose these paths.
 */
async function routeTestHook(request: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const match = TEST_HOOK_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const boardId = decodeURIComponent(match[1]!);
  if (!isValidBoardId(boardId)) return new Response('invalid board id', { status: 400 });
  const action = match[2];
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const result =
    action === 'corrupt-snapshot'
      ? await room.testCorruptSnapshot()
      : action === 'repair-snapshot'
        ? await room.testRepairSnapshot()
        : await room.testBoardSummary();
  return new Response(JSON.stringify({ ok: true, action, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeRoom(request, env)) ??
      (await routeTestHook(request, env)) ??
      env.ASSETS.fetch(request)
    );
  },
};

// The class lives in its own module; re-exported here so wrangler can find the
// `BoardRoom` named in `durable_objects.bindings`.
export { BoardRoom } from './board-room';
