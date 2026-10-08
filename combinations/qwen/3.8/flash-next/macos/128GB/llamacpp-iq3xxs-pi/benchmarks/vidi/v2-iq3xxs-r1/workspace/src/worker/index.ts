import { isValidBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
import { routeTestHook } from './test-hooks';
import { handleServe, handleUpload } from './assets';
import type { BoardRoom } from './board-room';

/**
 * Bindings configured in `wrangler.jsonc`: the room namespace (one Durable
 * Object per board), the built client, and the bucket that holds board images.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Stored images, one object per upload (`assets.ts`). */
  ASSETS_BUCKET: R2Bucket;
  /** `'1'` turns on the `/__test/boards/...` damage routes. Absent in production. */
  TEST_HOOKS?: string;
}

/** `/api/rooms/:boardId` — the room websocket. */
const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
/** `POST /api/boards` — create a board (story 5, `share.board_api`). */
const BOARDS_PATH = '/api/boards';
/** `GET /api/boards/:boardId` — does this board exist? */
const BOARD_PATH = /^\/api\/boards\/([^/]+)$/;
/** `POST /api/boards/:boardId/assets` — upload one image to one board (story 12). */
const ASSET_UPLOAD_PATH = /^\/api\/boards\/([^/]+)\/assets$/;
/**
 * `GET /api/assets/:boardId/:assetId` — one stored image (story 12).
 *
 * The whole rest of the path is the key, rather than two captured segments: a key
 * that is not exactly `<board id>/<asset id>` — including one with an extra segment —
 * has to reach `ASSET_KEY_PATTERN` and be refused there, instead of falling through
 * to the static assets and answering 200 with the board page.
 */
const ASSET_PATH = /^\/api\/assets\/(.+)$/;

/** The JSON bodies these routes send. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `/api/rooms/:boardId` — connect to a board's room.
 *
 * Boards stay separate (PRD live.isolation) because `idFromName(boardId)` routes
 * each board to its own object, which only knows its own sockets and its own
 * document.
 *
 * Nothing here counts participants, so the 6th person on a board is accepted
 * like anyone else (PRD live.over_capacity): `MAX_CONCURRENT_EDITORS` is a
 * design and test target, never enforced.
 *
 * Story 5: a malformed id is no longer a 400. It gets the same 404 an unknown id
 * gets — nothing is revealed about which half of the link was wrong, and the
 * Worker never instantiates a Durable Object to find out (TC-07). Whether an
 * *unknown* id exists is answered by the room itself, which checks its own storage
 * before accepting the socket (TC-09).
 */
async function routeRoom(request: Request, env: Env): Promise<Response | null> {
  const match = ROOM_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;

  const boardId = decodeURIComponent(match[1]!);
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected a websocket connection', { status: 426 });
  }

  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return room.fetch(request);
}

/**
 * The board API (story 5, `share.board_api`):
 *
 * | method + path            | success         | errors                                      |
 * |--------------------------|-----------------|---------------------------------------------|
 * | `POST /api/boards`       | `201 {"id": …}` | `500 {"error":"create_failed"}`             |
 * | `GET /api/boards/:id`    | `200 {"id": …}` | `404 {"error":"not_found"}` (unknown *or* malformed) |
 * | any other method         | —               | `405`                                       |
 *
 * Creation is one id plus one `initialize()` RPC and one small SQLite write, so it
 * fits comfortably inside `CREATE_BUDGET_MS` (PRD share.create). There is no retry
 * loop: a collision between two 128-bit ids is not a practical event, and if one
 * ever happened the caller gets `create_failed` rather than a silent second board.
 */
async function routeBoards(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  if (pathname === BOARDS_PATH) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const created = await createBoard(env);
    return created.ok ? json({ id: created.id }, 201) : json({ error: created.reason }, 500);
  }

  const match = BOARD_PATH.exec(pathname);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const boardId = decodeURIComponent(match[1]!);
  // Malformed and unknown answer identically, and neither touches storage.
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return (await room.exists()) ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
}

/**
 * The asset API (story 12, `assets.api`): images are uploaded to a board that exists
 * and served back by an unguessable key. See `assets.ts` for both handlers.
 *
 * A board id that is malformed, and a board nobody created, both answer `404`; a body
 * over `IMAGE_MAX_BYTES` answers `413`; bytes that are not one of the four accepted
 * image formats answer `415`; a bucket that fails answers `500`. Nothing is stored on
 * any of those paths.
 */
async function routeAssets(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  const upload = ASSET_UPLOAD_PATH.exec(pathname);
  if (upload) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const boardId = decodeSegment(upload[1]!);
    if (boardId === null) return json({ error: 'not_found' }, 404);
    return handleUpload(request, env, boardId);
  }

  const serve = ASSET_PATH.exec(pathname);
  if (!serve) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const key = decodeSegment(serve[1]!);
  if (key === null) return json({ error: 'not_found' }, 404);
  return handleServe(env, key);
}

/**
 * Percent-decoded path text, or `null` when it could not be decoded at all.
 * A malformed escape (`%zz`) is a request that cannot name a real board or key, so it
 * gets the same answer as any other unknown one.
 */
function decodeSegment(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Requests that are not the room or the board API are static assets, so `/`,
 * `/b/<id>` and every other client route fall through to the SPA fallback
 * configured in `wrangler.jsonc`.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routeRoom(request, env)) ??
      (await routeBoards(request, env)) ??
      (await routeAssets(request, env)) ??
      (await routeTestHook(request, env)) ??
      env.ASSETS.fetch(request)
    );
  },
};

// The class lives in its own module; re-exported here so wrangler can find the
// `BoardRoom` named in `durable_objects.bindings`.
export { BoardRoom } from './board-room';
