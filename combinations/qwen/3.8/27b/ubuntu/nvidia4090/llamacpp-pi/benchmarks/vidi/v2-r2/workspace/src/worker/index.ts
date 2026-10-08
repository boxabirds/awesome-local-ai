/**
 * vidi6 Worker entry (stories 3-5).
 *
 * Routes:
 * - `POST /api/boards` — create a board (story 5): 201 with a fresh 128-bit
 *   id, or 500 create_failed.
 * - `GET /api/boards/:id` — existence check (story 5): 200 or 404
 *   (unknown AND malformed ids are indistinguishable; nothing is leaked and
 *   nothing is written).
 * - `/api/rooms/:boardId` — WebSocket to that board's BoardRoom Durable
 *   Object. Unknown boards are rejected with 404 before a socket is
 *   accepted (story 5); 426 without an upgrade.
 * - everything else — static assets (SPA fallback serves index.html for
 *   `/b/<boardId>`).
 *
 * Boards stay separate (live.isolation): `idFromName(boardId)` gives every
 * board its own object instance, so a room only ever sees and broadcasts to
 * sockets on its own board. There is no participant counting and no
 * connection limit (live.over_capacity): the 6th or later person is
 * accepted like anyone else.
 */

import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * '1' only in the e2e wrangler environment. Enables the test-only storage
   * damage hooks (TC-24) and the legacy-board seed hook (story 5 TC-31);
   * never set in production config, so the production build has no hook
   * routes (their paths fall through to the SPA).
   */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
const API_BOARDS_PATH = /^\/api\/boards$/;
const API_BOARD_PATH = /^\/api\/boards\/([^/]+)$/;
// Test-only storage damage/repair/seed hooks (src/worker/test-hooks.ts).
const TEST_HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair|seed-legacy)$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 404 with the contract body; unknown and malformed ids are identical. */
function notFound(): Response {
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Registered only when TEST_HOOKS is '1' (e2e). The room performs the
    // damage/repair/seed on its own storage and re-runs the real load path.
    if (env.TEST_HOOKS === '1') {
      const hook = TEST_HOOK_PATH.exec(pathname);
      if (hook !== null) {
        const boardId = decodeURIComponent(hook[1] ?? '');
        if (!isValidBoardId(boardId)) {
          return notFound();
        }
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
        return stub.fetch(request);
      }
    }

    // --- board creation + existence API (story 5, share.board_api) -------
    if (API_BOARDS_PATH.test(pathname)) {
      if (request.method === 'POST') {
        const result = await createBoard(env);
        return result.ok ? json({ id: result.id }, 201) : json({ error: result.reason }, 500);
      }
      // Collection has no other methods (TC-14).
      return new Response('Method Not Allowed', { status: 405 });
    }
    const boardMatch = API_BOARD_PATH.exec(pathname);
    if (boardMatch !== null) {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = decodeURIComponent(boardMatch[1] ?? '');
      // Validate BEFORE touching the namespace: a malformed id never
      // instantiates an object (TC-07).
      if (!isValidBoardId(boardId)) {
        return notFound();
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      return exists ? json({ id: boardId }, 200) : notFound();
    }

    const match = ROOM_PATH.exec(pathname);
    if (match !== null) {
      const boardId = decodeURIComponent(match[1] ?? '');
      // Invalid id: reject before touching the namespace, so no object
      // instance is created for it. Story 5: malformed and unknown ids are
      // indistinguishable to callers (404, was 400 in story 3).
      if (!isValidBoardId(boardId)) {
        return notFound();
      }
      const upgrade = request.headers.get('Upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return new Response('Upgrade Required', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
