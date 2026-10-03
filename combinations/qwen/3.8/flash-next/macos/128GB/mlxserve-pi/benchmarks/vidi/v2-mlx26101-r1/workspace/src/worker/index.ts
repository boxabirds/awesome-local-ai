// Worker entry: create boards, answer whether a board exists, and route WebSocket
// upgrades for a board to that board's BoardRoom Durable Object; everything else is
// served from the static assets binding.
//
// Routing rules (sync.worker_entry + share.board_api contracts):
//   POST /api/boards                              -> 201 {"id"} | 500 {"error"}
//   any other method on /api/boards               -> 405
//   GET  /api/boards/:boardId                     -> 200 {"id"} | 404 {"error"}
//   GET  /api/rooms/:boardId + Upgrade: websocket -> that board's BoardRoom
//     malformed id                                -> 404 (was 400 before story 5)
//     unknown board                               -> 404, no socket, nothing written
//     no upgrade                                  -> 426 Upgrade Required
//   anything else                                 -> env.ASSETS.fetch (SPA)
//
// An unknown board and a malformed id get the same answer on purpose: nothing is
// leaked about which of the two it was, and neither creates a board (share.not_found).
//
// Isolation (live.isolation): `idFromName(boardId)` gives every board its own
// BoardRoom instance, holding only that board's document and broadcasting only
// to its own sockets.
//
// Soft capacity (live.over_capacity): nothing here counts participants and there
// is no connection limit, so a 6th (or 60th) person is never refused.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { boardExists, createBoard } from './create-board';
import { handleTestHook } from './test-hooks';

export interface Env {
  /** This board's room: one Durable Object per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served with an SPA fallback (see wrangler.jsonc). */
  ASSETS: Fetcher;
  /**
   * Set to `'1'` only by the e2e `wrangler dev` command line to enable the
   * `/__test/...` board-surgery hooks. Absent in `wrangler.jsonc`, so a production
   * deploy never exposes them.
   */
  TEST_HOOKS?: string;
}

/** Everything under this prefix is a board room WebSocket endpoint. (Not exported:
 * a Worker module may only export handlers/classes, so it stays module-private.) */
const ROOM_ROUTE_PREFIX = '/api/rooms/';
const ROOM_ROUTE_ROOT = '/api/rooms';

/** The board collection (`POST /api/boards`) and one board (`GET /api/boards/:id`). */
const BOARDS_ROUTE = '/api/boards';
const BOARDS_ROUTE_PREFIX = '/api/boards/';

/** A JSON response with the standard headers every API answer carries. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NOT_FOUND = (): Response => json({ error: 'not_found' }, 404);
const METHOD_NOT_ALLOWED = (): Response =>
  new Response(null, { status: 405, headers: { Allow: 'POST, GET' } });

/** The requested board id, '' for a room route with a missing/too-deep id, or
 * null when the path is not a room route at all (so the site root never matches). */
function boardIdFromPathname(pathname: string): string | null {
  if (pathname === ROOM_ROUTE_ROOT) return '';
  if (!pathname.startsWith(ROOM_ROUTE_PREFIX)) return null;
  const id = pathname.slice(ROOM_ROUTE_PREFIX.length);
  if (id.includes('/')) return '';
  try {
    return decodeURIComponent(id);
  } catch {
    return id; // malformed escape sequence: isValidBoardId rejects it
  }
}

/** The id in `/api/boards/:id`, '' when the path is a board route with a missing
 * or too-deep id, or null when the path is not a board route at all. */
function boardIdFromApiPathname(pathname: string): string | null {
  if (!pathname.startsWith(BOARDS_ROUTE_PREFIX)) return null;
  const id = pathname.slice(BOARDS_ROUTE_PREFIX.length);
  if (id === '' || id.includes('/')) return '';
  try {
    return decodeURIComponent(id);
  } catch {
    return id; // malformed escape sequence: isValidBoardId rejects it
  }
}

/** True for an HTTP request asking to switch protocols to WebSocket. */
function isUpgradeToWebsocket(request: Request): boolean {
  const upgrade = request.headers.get('Upgrade');
  return upgrade !== null && upgrade.trim().toLowerCase() === 'websocket';
}

/**
 * The `/api/boards` collection and `/api/boards/:id` existence check. Returns null
 * for any path outside the board API, so the caller continues routing.
 */
async function handleBoardApi(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (pathname === BOARDS_ROUTE) {
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED();
    const created = await createBoard(env);
    if (!created.ok) return json({ error: 'create_failed' }, 500);
    return json({ id: created.id }, 201);
  }

  const id = boardIdFromApiPathname(pathname);
  if (id === null) return null;
  if (request.method !== 'GET') return METHOD_NOT_ALLOWED();
  if (id === '' || !isValidBoardId(id)) return NOT_FOUND();

  // Only now does the id reach the namespace: a malformed link never instantiates
  // an object (TC-07), and an unknown one only ever reads (TC-06).
  return (await boardExists(env, id)) ? json({ id }, 200) : NOT_FOUND();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test-only board surgery, present only when TEST_HOOKS=1 is set on the dev
    // server; otherwise this returns null and normal routing continues.
    const hook = await handleTestHook(request, env);
    if (hook !== null) return hook;

    const boardApi = await handleBoardApi(request, env, url.pathname);
    if (boardApi !== null) return boardApi;

    const boardId = boardIdFromPathname(url.pathname);
    if (boardId === null) return env.ASSETS.fetch(request);

    if (!isValidBoardId(boardId)) {
      // Never instantiate an object for a malformed or missing id. Since story 5 a
      // bad link is "not found" rather than "bad request" — the same answer an
      // unknown board gives, so nothing is leaked (share.not_found).
      return NOT_FOUND();
    }
    if (!isUpgradeToWebsocket(request)) {
      return new Response('Upgrade: websocket required', { status: 426 });
    }

    // The room answers the upgrade itself, and refuses a board that does not exist
    // with 404 before accepting the socket (share.not_found).
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return room.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Re-exported so `wrangler.jsonc` can bind the class by name.
export { BoardRoom };
