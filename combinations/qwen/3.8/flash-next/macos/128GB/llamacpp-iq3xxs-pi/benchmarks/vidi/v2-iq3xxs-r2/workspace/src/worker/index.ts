import { isValidBoardId } from '../shared/board-id';
import { ROOM_PATH_PREFIX } from '../shared/protocol';
import { handleServe, handleUpload } from './assets';
import { createBoard } from './create-board';
import { BoardRoom, TEST_HOOK_PREFIX } from './board-room';

/**
 * Everything the Worker needs from the platform: the room namespace and the built
 * client. See `wrangler.jsonc` for the bindings.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Image bytes, by `<boardId>/<assetId>` key (story 12). The board document keeps the keys;
   * the bytes never travel through the Durable Object, so a board with a thousand images
   * still loads at the speed of its document.
   */
  ASSETS_BUCKET: R2Bucket;
  /**
   * `'1'` turns on the room's test-only storage routes (`/__test/...`), and is never
   * set in production config — the default deployment has no way to damage a board
   * through the front door (design: "Test hooks are the only non-protocol route").
   */
  TEST_HOOKS?: string;
}

/** Where boards are created and where their existence is checked (story 5). */
const BOARDS_PATH = '/api/boards';
const BOARDS_PREFIX = '/api/boards/';
/** The one sub-resource of a board: `POST /api/boards/:id/assets` (story 12). */
const ASSETS_SUB_PATH = 'assets';

/** Everything under the prefix belongs to the room: `/api/rooms/` owns its whole tree. */
function boardIdOf(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_PATH_PREFIX)) return null;
  const encoded = pathname.slice(ROOM_PATH_PREFIX.length);
  // An empty or undecodable address is not a board (404, story 5), never a route to the client.
  if (encoded === '') return '';
  try {
    // `%2F` decoding to a `/` is checked against the id pattern by the caller.
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

/** True when the request is the WebSocket upgrade a board client sends. */
function isUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Where a board's images are stored, and how their keys come back out of a URL. */
const ASSETS_PREFIX = '/api/assets/';

/** `405` with the methods this route answers, so a wrong verb says what it wanted. */
function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', Allow: allow },
  });
}

/**
 * `/api/boards` (create) and `/api/boards/:id` (does it exist?).
 *
 * Both answers are the whole of the board API, and both are deliberately unhelpful
 * about *why* a link is no good: a malformed id and an unknown one get the same 404, so
 * nothing about an existing board leaks to somebody guessing at addresses, and a
 * malformed one never reaches the namespace, so it cannot even instantiate an object
 * (`share.not_found`, TC-07).
 */
async function boards(request: Request, env: Env, pathname: string): Promise<Response> {
  if (pathname === BOARDS_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const created = await createBoard(env);
    if (!created.ok) return json({ error: 'create_failed' }, 500);
    return json({ id: created.id }, 201);
  }

  const rest = pathname.slice(BOARDS_PREFIX.length);
  const separator = rest.indexOf('/');
  if (separator >= 0) {
    // One thing lives below a board besides the board itself: the images uploaded into it.
    // Anything else under the prefix is an address that has never existed, and says so.
    const boardId = rest.slice(0, separator);
    const sub = rest.slice(separator + 1);
    if (sub !== ASSETS_SUB_PATH) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return handleUpload(request, env, boardId);
  }

  const boardId = rest;
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET');
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);

  // A well-formed id asks the board's own object, which answers from storage alone.
  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
}

/**
 * `/api/assets/:boardId/:assetId` — one image, by the key its upload was answered with.
 *
 * The key is read out of the path and then checked (`image-format`'s pattern), so this route
 * only ever passes on addresses that can name an object; a path that cannot is answered here
 * rather than by asking the bucket. Board ownership is not re-checked from the key's first
 * half, because keys are random, unguessable and never rewritten: an image is served to
 * whoever holds its address, which is the property story 17's export relies on.
 */
async function assets(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET');
  let key = '';
  try {
    key = decodeURIComponent(pathname.slice(ASSETS_PREFIX.length));
  } catch {
    // A path with a broken escape in it is not a key; `handleServe` would say the same, but
    // it cannot be handed text that never decoded.
    return new Response(null, { status: 404 });
  }
  return handleServe(env, key);
}

/**
 * The whole Worker: `/api/boards` creates boards and says whether they exist,
 * `/api/boards/:id/assets` and `/api/assets/:boardId/:assetId` move image bytes in and out
 * (story 12), `/api/rooms/:boardId` belongs to that board's room, and everything else is the
 * client.
 * There is no participant counting anywhere in here — the `MAX_CONCURRENT_EDITORS`
 * capacity is a design and test target, never enforced, so a sixteenth person joins
 * exactly like a first one (`live.over_capacity`).
 *
 * Boards stay separate (`live.isolation`) because `idFromName(boardId)` gives every
 * board its own `BoardRoom` object, and that object only knows its own sockets.
 *
 * Story 5 made board existence a fact rather than an accident: a board is created by
 * `POST /api/boards`, an unknown address gets a 404 from both the HTTP API and the
 * WebSocket route, and nothing in either path creates storage.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // `/__test/:boardId/...` are the room's storage-damage routes; the room itself
    // answers 404 unless `TEST_HOOKS` is on, so production never exposes them.
    if (pathname.startsWith(TEST_HOOK_PREFIX)) {
      const parts = pathname.slice(TEST_HOOK_PREFIX.length).split('/');
      const hookBoardId = parts[0] ?? '';
      if (parts.length < 2 || !isValidBoardId(hookBoardId)) {
        return new Response('invalid test hook path', { status: 400 });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hookBoardId)).fetch(request);
    }

    if (pathname === BOARDS_PATH || pathname.startsWith(BOARDS_PREFIX)) {
      return boards(request, env, pathname);
    }

    if (pathname.startsWith(ASSETS_PREFIX)) {
      return assets(request, env, pathname);
    }

    const boardId = boardIdOf(pathname);
    if (boardId === null) return env.ASSETS.fetch(request);

    // Story 5: a bad board address is simply a board that is not there — the same 404
    // an unknown one gets, so nothing is revealed and nothing is created (TC-07, TC-09).
    if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
    if (!isUpgrade(request)) {
      // The room speaks WebSockets only; the client's own address is a page, not an API.
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    // `get(...).fetch(...)` hands the upgrade to the room, which answers 101 itself —
    // or 404, when nobody has ever created this board.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
};

export { BoardRoom };
