// Worker entry: the board API (POST /api/boards, GET /api/boards/:id), WebSocket
// upgrades for /api/rooms/:boardId to that board's BoardRoom Durable Object, and
// everything else to the static assets binding. See design "Worker entry and
// routing" (story 3) and "Board creation and existence API" (story 5).

import { isValidBoardId } from '../shared/board-id.ts';
import { BoardRoom } from './board-room.ts';
import { createBoard, type Limiter } from './create-board.ts';
import { parseTestHook, testHookNotFound, testHooksEnabled } from './test-hooks.ts';

export { BoardRoom } from './board-room.ts';
export { testHooksEnabled, parseTestHook } from './test-hooks.ts';
export type { CreateResult, Limiter } from './create-board.ts';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Rate Limiting API binding for board creation (share.rate_limit). Declared
   * with the structural `Limiter` type the create path actually uses; the
   * platform injects the real binding named in wrangler.jsonc, whose limit and
   * period mirror the named settings there (TC-03 asserts the parity).
   */
  BOARD_CREATE_LIMITER: Limiter;
  /**
   * Set to '1' only by the e2E harnesses (`wrangler dev --var`). Enables the
   * /__test/boards/:id/… storage actions design TC-24 and TC-31 need; absent
   * everywhere else, where those routes answer 404. See `src/worker/test-hooks.ts`.
   */
  VIDI_TEST_HOOKS?: string;
  /**
   * TEST SEAM ONLY: deterministic board-id generator for the collision
   * integration test (TC-11). Never set in any deployment config.
   */
  VIDI_TEST_ID_GENERATOR?: () => string;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
const BOARDS_COLLECTION = '/api/boards';
const BOARD_ITEM = /^\/api\/boards\/([^/]+)$/;

/**
 * Visitor key for the creation rate limit. The platform sets `CF-Connecting-IP`
 * on every real request; a local `wrangler dev` has no such header, so requests
 * without one share a single bucket rather than escaping the limit.
 */
function visitorKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local-visitor';
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomMatch = ROOM_PATH.exec(url.pathname);
    const testHook = parseTestHook(url.pathname);
    const boardMatch = BOARD_ITEM.exec(url.pathname);

    if (url.pathname.startsWith('/__test/')) {
      // Anything under /__test/ that is not an enabled, well-formed hook call is
      // simply not here — never the SPA fallback, so a mis-typed hook call can
      // never look like a working route.
      if (!testHook || !testHooksEnabled(env) || request.method !== 'POST') {
        return testHookNotFound();
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(testHook.boardId)).fetch(request);
    }

    // ------------------------------------------------ board creation (share.create)
    if (url.pathname === BOARDS_COLLECTION) {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      const result = await createBoard(env, visitorKey(request));
      if (result.ok) return json({ id: result.id }, 201);
      if (result.reason === 'rate_limited') {
        return json({ error: 'rate_limited' }, 429);
      }
      return json({ error: 'create_failed' }, 500);
    }

    // --------------------------------------------- board existence (share.open_link)
    if (boardMatch) {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      const id = boardMatch[1];
      // Malformed ids answer 404 like any unknown board — nothing about the id
      // format is leaked, and the namespace is never touched, so a malformed id
      // cannot instantiate a Durable Object (TC-07).
      if (!isValidBoardId(id)) {
        return json({ error: 'not_found' }, 404);
      }
      const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).exists();
      return exists ? json({ id }, 200) : json({ error: 'not_found' }, 404);
    }

    if (roomMatch) {
      const boardId = roomMatch[1];
      // Validate before touching the namespace so an invalid id can never
      // instantiate a Durable Object (story 3 TC-04). Story 5: a malformed id is
      // not a board, so it is 404 like an unknown one rather than a 400.
      if (!isValidBoardId(boardId)) {
        return json({ error: 'not_found' }, 404);
      }
      const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      // idFromName(boardId) gives each board its own object — this is what keeps
      // boards isolated (live.isolation). There is deliberately no participant
      // count check: an over-capacity joiner is never refused (live.over_capacity).
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
