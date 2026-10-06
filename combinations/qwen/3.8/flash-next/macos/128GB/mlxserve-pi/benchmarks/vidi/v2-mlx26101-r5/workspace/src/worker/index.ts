/**
 * The Worker entry point: the only thing that stands between a request and the
 * board it asked for.
 *
 *   GET /api/rooms/:boardId  (Upgrade: websocket)  →  that board's BoardRoom
 *   everything else                                →  the static client
 *
 * `idFromName(boardId)` is what keeps boards separate: every connection for a
 * board lands in that board's own object, which holds only that board's document
 * and only ever broadcasts to its own sockets.
 *
 * Nothing here counts participants. The simultaneous-editor capacity
 * (`MAX_CONCURRENT_EDITORS`) is a design and test target, so a 6th person joining a
 * board is accepted and can edit like anybody else.
 */

import { isValidBoardId } from '../shared/board-id';
import { ROOM_PATH_PREFIX } from '../shared/config';
import type { BoardRoom } from './board-room';
import { boardExists, createBoard } from './create-board';
import { assetKeyFor } from '../shared/image-format';
import { handleServe, handleUpload } from './assets';
import { routeTestHook } from './test-hooks';

/** Bindings declared in `wrangler.jsonc`. */
export interface Env {
  /** One BoardRoom per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served with a single-page-application fallback. */
  ASSETS: Fetcher;
  /**
   * The board's pictures. One bucket for every board, and a key that names the board each
   * picture belongs to — an image has no state to share and nothing to relay, so it does not
   * live in a board's SQLite, it lives here.
   */
  ASSETS_BUCKET: R2Bucket;
  /**
   * `'1'` turns on the storage hooks the persistence e2e tests use to break a board on
   * purpose. It is a deployment-time variable and is set by nothing in this repo's config,
   * so a normal build has no such routes. Nothing else enables it: not `'true'`, not `'0'`.
   */
  TEST_HOOKS?: string;
}

/** Every room request starts here; the rest of the path is the board id. */
const ROOM_PREFIX = `${ROOM_PATH_PREFIX}/`;

/** Where boards are created and looked up: `POST /api/boards`, `GET /api/boards/:id`. */
const BOARDS_PATH = '/api/boards';
/** `POST /api/boards/:boardId/assets` — one picture, uploaded into a board. */
const BOARD_ASSETS = /^\/api\/boards\/([^/]+)\/assets$/;
/** `GET /api/assets/:boardId/:assetId` — one picture, read back out of a board. */
const ASSET_ITEM = /^\/api\/assets\/([^/]+)\/([^/]+)$/;

/** The rest of the path after a prefix, or null when the prefix is not there. */
function after(path: string, prefix: string): string | null {
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The room route is `/api/rooms/:boardId` — the same id in the same position. */
const BOARD_PREFIX = `${BOARDS_PATH}/`;

/** Everything under `/api/` belongs to the Worker, never to the client bundle. */
const API_PREFIX = '/api/';

/** One path segment, decoded — an id with a `%` in it is still the id the address meant. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** True for a WebSocket upgrade request (the header is case-insensitive). */
function isUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/** A machine-readable error for an API request; never the client's index.html. */
function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-vidi6-error': code,
    },
  });
}

/** A JSON answer from the board API. */
function apiJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * `POST /api/boards` — make a board — and `GET /api/boards/:id` — is this link a board?
 *
 * Both are answers about existence and nothing else: there is no list of anybody's boards,
 * and a wrong method is a 405 rather than a guess at what was meant.
 */
async function routeBoards(request: Request, env: Env, boardId: string | null): Promise<Response> {
  if (boardId === null) {
    // `/api/boards` itself. Only a POST creates; in particular a GET does not list anybody's
    // boards, because there is no such thing in any current story.
    if (request.method !== 'POST') {
      return apiError(405, 'method_not_allowed', 'Boards are created by POSTing to this path.');
    }
    const created = await createBoard(env);
    if (!created.ok) {
      return apiError(500, created.reason, 'The board could not be created.');
    }
    return apiJson({ id: created.id }, 201);
  }

  if (request.method !== 'GET') {
    return apiError(405, 'method_not_allowed', 'A board is read with GET.');
  }
  // A malformed id is rejected here, so it never names a Durable Object at all. The answer is
  // the same 404 an unknown id gets: the difference between "not a link" and "nobody's link"
  // is not worth leaking to whoever is asking.
  if (!isValidBoardId(boardId)) {
    return apiError(404, 'not_found', 'No such board.');
  }
  if (await boardExists(env, boardId)) return apiJson({ id: boardId });
  return apiError(404, 'not_found', 'No such board.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    // A picture, in either direction. Both are decided before the board routes below: an upload is not
    // a question about a board's state and a fetch is not either — one files bytes under a board's name
    // and the other reads them back — and `/api/boards/:id/assets` would otherwise be answered by the
    // route that only ever expects one segment after the id. Neither one is validated here: the shape of
    // an id and the shape of a key belong to the two handlers, because a handler that owns a check is
    // the only place it can be written once.
    const upload = path.match(BOARD_ASSETS);
    if (upload !== null) {
      return handleUpload(request, env, decodeSegment(upload[1] as string));
    }
    const asset = path.match(ASSET_ITEM);
    if (asset !== null) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return apiError(405, 'method_not_allowed', 'A stored picture is read by GET.');
      }
      return handleServe(env, assetKeyFor(decodeSegment(asset[1] as string), decodeSegment(asset[2] as string)));
    }

    if (path === BOARDS_PATH || path.startsWith(BOARD_PREFIX)) {
      const rest = after(path, BOARD_PREFIX);
      // `/api/boards` itself has no id on the end; anything below it has exactly one path
      // segment, which is either a board id or not.
      const boardId = path === BOARDS_PATH ? null : rest === null ? null : rest;
      return routeBoards(request, env, boardId);
    }
    if (path.startsWith(ROOM_PREFIX)) {
      const boardId = path.slice(ROOM_PREFIX.length);
      // A board id is 22 base64url characters; anything else is a bad address, and it is
      // answered here so that no object instance is ever created for it. Story 3 made this a
      // 400; story 5 makes it the same 404 as a link to a board that does not exist, because
      // that is what it is.
      if (!isValidBoardId(boardId)) {
        return apiError(404, 'invalid_board_id', 'A board id is 22 characters of [A-Za-z0-9_-].');
      }
      // The route exists only as a WebSocket. A plain GET would otherwise be an
      // assets miss rendered as index.html, which is useless to a client.
      if (!isUpgrade(request)) {
        return apiError(426, 'upgrade_required', 'This board is reachable over a WebSocket.');
      }
      // `idFromName` is the whole isolation story: one stable id per board, so every
      // connection to a board reaches that board's room and no other. Whether the board exists
      // at all is the room's answer, not this one's — it is the object that can look in its own
      // storage without anybody guessing.
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    // Any other `/api/` path is a bad address, and a client shell served there
    // would be fetched as if it were data.
    if (path === '/api' || path.startsWith(API_PREFIX)) {
      return apiError(404, 'not_found', `No such endpoint: ${path}`);
    }
    // Test-only storage hooks (see `test-hooks.ts`): they have to reach a board's object,
    // so they are routed before the static client swallows the path. When the deployment has
    // not switched them on this returns null immediately and nothing here changes.
    const hook = await routeTestHook(request, env);
    if (hook) return hook;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom } from './board-room';
