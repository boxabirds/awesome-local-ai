/**
 * The board Worker (stories 3 to 5).
 *
 * Three jobs, and deliberately nothing else:
 *
 *  - `/api/boards` creates a board, and `/api/boards/<id>` says whether one
 *    exists. Creation is the only way a board comes into the world.
 *  - `/api/rooms/<boardId>` with a valid id for a board that exists, and an
 *    `Upgrade: websocket` request, is forwarded to the BoardRoom object named
 *    after that board. The name *is* the isolation boundary: two boards can
 *    never share a room because they can never share an object id.
 *  - everything else is handed to the static assets binding, which answers
 *    `/b/<boardId>` with index.html (single-page-application fallback).
 *
 * ## Opening a room is no longer the same as making a board
 *
 * Until story 5, any well-formed id in a room address started a room, which is
 * how a mistyped link looked like a blank board. Now a room address is checked
 * against the board that supposedly lives at it, and an unknown id is a `404`.
 * The check reads and never writes, so a stranger guessing at the id space
 * leaves no storage behind — which is the only way "nothing is created at a
 * broken link" is actually true rather than merely intended.
 *
 * There is still no participant counting and no capacity check: the configured
 * capacity is a design and test target, never a door that closes (PRD
 * live.over_capacity).
 */
import { isValidBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
import type { Env } from './env';

/** Everything under this prefix is a room address, valid or not. */
const ROOM_PREFIX = '/api/rooms/';

/** The board collection, and the board-address prefix, share `/api/boards`. */
const BOARDS_PATH = '/api/boards';

/** Split `/api/rooms/<id>` into its id and whatever trailing junk follows. */
function roomAddress(pathname: string): { boardId: string; rest: string } | null {
  if (!pathname.startsWith(ROOM_PREFIX)) return null;
  const remainder = pathname.slice(ROOM_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash === -1) return { boardId: remainder, rest: '' };
  return { boardId: remainder.slice(0, slash), rest: remainder.slice(slash) };
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

function plainError(status: number, statusText: string, body: string): Response {
  return new Response(body, { status, statusText });
}

/** A JSON error the client's `api.ts` is written to recognise. */
function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The id in `/api/boards/<id>`, or `null` if this is not a board lookup.
 *
 * `PUT /api/boards` and `POST /api/boards/<id>` answer through the same branch
 * as the two methods that mean something here, so a wrong verb is a `405`
 * rather than an accidental lookup.
 */
function boardLookup(pathname: string): { boardId: string; exact: boolean } | null {
  if (!pathname.startsWith(BOARDS_PATH)) return null;
  const remainder = pathname.slice(BOARDS_PATH.length);
  if (remainder === '') return { boardId: '', exact: true };
  if (!remainder.startsWith('/')) return null;
  const withoutSlash = remainder.slice(1);
  const slash = withoutSlash.indexOf('/');
  if (slash === -1) return { boardId: withoutSlash, exact: false };
  return { boardId: withoutSlash.slice(0, slash), exact: false };
}

/**
 * Whether a board exists, without being able to create one.
 *
 * The object is instantiated — that is what "does this board exist" costs, since
 * a board's facts live in its own object — but nothing is written: `exists()`
 * looks at the schema before it looks at any row, so an id nobody ever made does
 * not end up with a database of its own.
 */
async function boardExists(env: Env, boardId: string): Promise<boolean> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return stub.exists();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- the board collection -------------------------------------------------
    const lookup = boardLookup(url.pathname);
    if (lookup !== null) {
      if (lookup.exact) {
        if (url.pathname === BOARDS_PATH && request.method !== 'POST') {
          return jsonError(405, 'method_not_allowed');
        }
        if (request.method !== 'POST') {
          return jsonError(405, 'method_not_allowed');
        }
        // The visitor key is the connecting address, which the platform sets and
        // a browser cannot forge. There is no sign-in in this story, so it is the
        // only thing a per-visitor limit can be counted against, and it is why
        // the limit is a rough abuse guard rather than a security boundary.
        const visitor = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const created = await createBoard(env, visitor);
        if (created.ok) {
          return new Response(JSON.stringify({ id: created.id }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return created.reason === 'rate_limited'
          ? jsonError(429, 'rate_limited')
          : jsonError(500, 'create_failed');
      }

      let boardId = lookup.boardId;
      try {
        boardId = decodeURIComponent(boardId);
      } catch {
        return jsonError(404, 'not_found');
      }
      // A malformed id is answered here, before an object is looked up, and with
      // the same `404` an unknown-but-well-formed id gets. Telling the two apart
      // would tell a caller which shapes of id are real, and there is nothing
      // here worth that answer either way.
      if (!isValidBoardId(boardId)) return jsonError(404, 'not_found');
      return (await boardExists(env, boardId))
        ? new Response(JSON.stringify({ id: boardId }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : jsonError(404, 'not_found');
    }

    const address = roomAddress(url.pathname);
    if (address === null) {
      // Not a room and not the board API: the assets binding serves the app,
      // including the `/b/<boardId>` single-page fallback.
      return env.ASSETS.fetch(request);
    }

    let boardId = address.boardId;
    try {
      boardId = decodeURIComponent(boardId);
    } catch {
      return jsonError(404, 'not_found');
    }

    // Checked before any object is looked up: an address that cannot name a
    // board must not create or touch one (TC-04). `404` rather than story 3's
    // `400`, because to the person following a link a broken address and an
    // unknown one are the same event — a board that is not there.
    if (address.rest !== '' || !isValidBoardId(boardId)) {
      return jsonError(404, 'not_found');
    }
    if (!isWebSocketUpgrade(request)) {
      return plainError(426, 'Upgrade Required', 'upgrade to websocket required');
    }

    // The room itself re-checks this when the object wakes up; checking it here
    // is what keeps an unknown id from ever opening a socket, and what lets a
    // client answer "Board not found" before it has a half-open connection.
    if (!(await boardExists(env, boardId))) {
      return jsonError(404, 'not_found');
    }

    const id = env.BOARD_ROOM.idFromName(boardId);
    const room = env.BOARD_ROOM.get(id);
    return room.fetch(request);
  },
};

export type { Env };
export { BoardRoom } from './board-room';