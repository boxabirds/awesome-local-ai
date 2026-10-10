/**
 * Worker entry (sync.worker_entry, share.board_api): the only network front door
 * of the product.
 *
 * Three kinds of request come here:
 *
 * - `POST /api/boards` makes a board (share.create) and `GET /api/boards/:id`
 *   answers the one question a link can ask (share.not_found). A board's link is
 *   its only access control, so an id that is not well formed is answered here,
 *   without the namespace being asked — no Durable Object is ever created for
 *   `/api/boards/abc` (TC-07).
 * - `/api/rooms/:id` is the WebSocket endpoint of one board. Story 5 changed one
 *   thing about it: it no longer *makes* the board it is asked for. An unknown
 *   address is a 404, and the room behind it refuses the same thing from its own
 *   side (share.not_found).
 * - everything else is the static client, including `/b/:id`, which is a client
 *   route and answers with `index.html`.
 *
 * The Worker itself keeps no state — no participant counting, no connection
 * limit, no notion of which boards exist — so a 6th or 60th person is accepted
 * exactly like the first (live.over_capacity).
 */
import { BoardRoom } from './board-room';
import { createBoard, boardExists } from './create-board';
import { isValidBoardId } from '../shared/board-id';
import {
  SEED_LEGACY_PATH,
  seedLegacyBoardRoute,
  testHooksEnabled,
} from './test-hooks';

/**
 * Bindings this Worker needs, i.e. what `wrangler.jsonc` gives it. Declared in
 * `env.d.ts` (as `Cloudflare.Env`) so `import { env } from 'cloudflare:test'`
 * in the integration tests is the same type.
 */
export interface Env extends Cloudflare.Env {}

/** `/api/rooms/<boardId>` — the whole path is the id, nothing after it. */
const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

/** `/api/boards` — the collection, i.e. creating. */
const BOARDS_PATH = /^\/api\/boards\/?$/;

/** `/api/boards/<boardId>` — one board, i.e. the existence question. */
const BOARD_PATH = /^\/api\/boards\/([^/]+)$/;

/**
 * True when the request asks for a WebSocket handshake. Compared
 * case-insensitively because headers are case-insensitive by contract.
 */
function wantsUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/** The JSON these endpoints answer with, so the shapes never drift apart. */
function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/** `404 {"error":"not_found"}` — the same answer for "no" and for "nonsense". */
function notFound(): Response {
  return json({ error: 'not_found' }, 404);
}

async function handleRooms(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // A bad id never reaches the namespace, so no object is ever created for it
  // (TC-07). Story 3 answered this with 400; the difference between "that is
  // not a board" and "that never was a board" is not worth leaking.
  if (!isValidBoardId(boardId)) return notFound();
  if (!wantsUpgrade(request)) {
    return new Response('expected a websocket upgrade', { status: 426 });
  }
  // idFromName(boardId) is what keeps boards separate (live.isolation): all
  // connections of one id land in that id's own object, and nowhere else.
  const roomId = env.BOARD_ROOM.idFromName(boardId);
  // The room itself answers 404 when this address holds no board: the question
  // can only be answered by the object that owns the storage, and asking it
  // writes nothing (TC-09).
  return env.BOARD_ROOM.get(roomId).fetch(request);
}

/** `POST /api/boards` and `GET /api/boards/:id` (share.board_api). */
async function handleBoards(
  request: Request,
  env: Env,
  boardId: string | undefined,
): Promise<Response> {
  if (boardId === undefined) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const created = await createBoard(env);
    if (!created.ok) return json({ error: created.reason }, 500);
    return json({ id: created.id }, 201);
  }
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  // Malformed: nothing is asked of the namespace, and the answer is the same
  // 404 a real-but-unknown id gets (TC-07).
  if (!isValidBoardId(boardId)) return notFound();
  const exists = await boardExists(env, boardId);
  return exists ? json({ id: boardId }, 200) : notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Test routes: switched on by a variable only the test servers set, and
    // answered 404 as though the route did not exist everywhere else.
    if (testHooksEnabled(env)) {
      const seeded = SEED_LEGACY_PATH.exec(pathname);
      if (seeded !== null) {
        return seedLegacyBoardRoute(request, env, seeded[1] ?? '');
      }
    }

    if (BOARDS_PATH.test(pathname)) return handleBoards(request, env, undefined);
    const board = BOARD_PATH.exec(pathname);
    if (board !== null) return handleBoards(request, env, board[1]);

    const room = ROOM_PATH.exec(pathname);
    if (room !== null) return handleRooms(request, env, room[1] ?? '');

    return env.ASSETS.fetch(request);
  },
};

// The Durable Object class lives in its own module; exporting it here is how
// wrangler finds it.
export { BoardRoom };
