/**
 * The vidi6 Worker: the front door of a board.
 *
 * Three jobs, and nothing else.
 *
 *  - `/api/boards` is the board API. `POST` makes a board — a fresh, unguessable
 *    address plus a Durable Object that says "this one exists" — and `GET
 *    /api/boards/<boardId>` answers whether an address belongs to one. An address that
 *    is not 22 base64url characters is answered here, without waking anything: probing
 *    a link must not create a board, and must not cost a Durable Object either.
 *  - `/api/rooms/<boardId>` is a WebSocket upgrade for that board. The id is validated
 *    the same way, and the room itself refuses unknown boards with 404. `idFromName(boardId)`
 *    is what keeps boards apart: every connection for a board lands in the same object,
 *    and no object ever sees another board's traffic (`live.isolation`).
 *  - everything else is the client: static assets, with an `index.html` fallback so
 *    `/b/<boardId>` is a client route rather than a file.
 *
 * Neither the Worker nor the room counts participants. The product's capacity
 * (`MAX_CONCURRENT_EDITORS`) is a design and test target, so a 6th person joining
 * a board is accepted exactly like anyone else (`live.over_capacity`).
 */

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHookRequest, testHooksEnabled, TEST_HOOK_PREFIX } from './test-hooks';
import { handleUpload, handleServe } from './assets';

/** Bindings declared in `wrangler.jsonc`. */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  /**
   * Set to `1` only by the end-to-end web server (`playwright.config.ts` passes
   * `--var TEST_HOOKS:1`). It turns on the `/__test/` board-surgery routes, and nothing
   * else changes; it is absent from `wrangler.jsonc`, so a deployed Worker cannot serve
   * them and a request to one gets the SPA like any other unknown path.
   */
  TEST_HOOKS?: string;
}

/** Everything under this prefix is one board's WebSocket endpoint. */
const ROOM_PREFIX = '/api/rooms/';

/** The board collection: `POST` here makes a board. */
const BOARDS_PATH = '/api/boards';

/** Everything under this prefix is one board's existence. */
const BOARDS_PREFIX = '/api/boards/';

/** Everything under this prefix is an asset serve request. */
const ASSETS_SERVE_PREFIX = '/api/assets/';

/** Is this the WebSocket handshake? (The client sends `Upgrade: websocket`.) */
function wantsWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/**
 * The single path segment after `prefix`, percent-decoded, or null when the path has
 * no such segment.
 *
 * A malformed percent-escape is not a decode failure to report; it is a bad address, and
 * gets the same 404 as any other address this Worker does not know. Returning null rather
 * than throwing is what keeps a mistyped link from becoming a 500.
 */
function segmentAfter(pathname: string, prefix: string): string | null {
  const raw = pathname.slice(prefix.length);
  if (raw === '' || raw.includes('/')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** `404 {"error":"not_found"}` — unknown and malformed addresses look identical. */
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/** `405`: the path is ours, the method is not. */
function methodNotAllowed(): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
}

/**
 * `POST /api/boards`, and nothing else on that path.
 *
 * A failure to create is a 500 rather than a retry: one id generation and one RPC have
 * no retry loop in them, because two 128-bit ids agreeing is not a thing that happens
 * (`share.unguessable`).
 */
async function createBoardResponse(env: Env): Promise<Response> {
  const created = await createBoard(env);
  if (!created.ok) return Response.json({ error: created.reason }, { status: 500 });
  return Response.json({ id: created.id }, { status: 201 });
}

/**
 * `GET /api/boards/<id>`: does this address belong to a board?
 *
 * The id is checked before the namespace is touched, so a made-up string never wakes a
 * Durable Object (TC-07). The answer comes from the room's read-only existence check,
 * which creates nothing (TC-06).
 */
async function checkBoardResponse(id: string | null, env: Env): Promise<Response> {
  if (id === null || !isValidBoardId(id)) return notFound();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  let exists: boolean;
  try {
    exists = await stub.exists();
  } catch (error) {
    // The object could not answer, which is not the same as there being no board:
    // a 5xx tells the client to keep retrying rather than to say "Board not found".
    console.error(
      JSON.stringify({ event: 'board_check_failed', error: error instanceof Error ? error.message : String(error) })
    );
    return Response.json({ error: 'check_failed' }, { status: 500 });
  }
  return exists ? Response.json({ id }) : notFound();
}

/** The board API, or null when this path is not part of it. */
async function handleBoardApi(pathname: string, request: Request, env: Env): Promise<Response | null> {
  if (pathname === BOARDS_PATH || pathname === `${BOARDS_PATH}/`) {
    if (request.method !== 'POST') return methodNotAllowed();
    return createBoardResponse(env);
  }
  // POST /api/boards/:id/assets — upload an image to a board
  if (pathname.startsWith(BOARDS_PREFIX)) {
    const rest = pathname.slice(BOARDS_PREFIX.length);
    if (rest.endsWith('/assets')) {
      const id = rest.slice(0, -'/assets'.length);
      if (request.method !== 'POST') return methodNotAllowed();
      return handleUpload(request, env, id);
    }
    if (request.method !== 'GET') return methodNotAllowed();
    return checkBoardResponse(segmentAfter(pathname, BOARDS_PREFIX), env);
  }
  return null;
}

/** Serve an image asset: GET /api/assets/:boardId/:assetId */
async function handleAssetServe(pathname: string, request: Request, env: Env): Promise<Response | null> {
  if (!pathname.startsWith(ASSETS_SERVE_PREFIX)) return null;
  if (request.method !== 'GET') return methodNotAllowed();
  const key = pathname.slice(ASSETS_SERVE_PREFIX.length);
  return handleServe(env, key);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // The gate is here rather than inside the handler: with the variable absent this
    // Worker has no `/__test/` route at all, and the path falls through to the assets
    // like any other one it does not know.
    if (testHooksEnabled(env) && url.pathname.startsWith(TEST_HOOK_PREFIX)) {
      return handleTestHookRequest(request, env);
    }

    const api = await handleBoardApi(url.pathname, request, env);
    if (api !== null) return api;

    const asset = await handleAssetServe(url.pathname, request, env);
    if (asset !== null) return asset;

    if (!url.pathname.startsWith(ROOM_PREFIX)) return env.ASSETS.fetch(request);

    // A malformed address is refused here, without waking a room. It is a 404 rather
    // than story 3's 400 because from the other side of a link the two are the same
    // thing: this address is not a board (`share.not_found`).
    const segment = segmentAfter(url.pathname, ROOM_PREFIX);
    if (segment === null || !isValidBoardId(segment)) return notFound();
    if (!wantsWebSocketUpgrade(request)) {
      return new Response('Upgrade Required', { status: 426 });
    }

    // One object per board id: that is the whole of the board's isolation.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(segment));
    return stub.fetch(request);
  }
};

export { BoardRoom };
