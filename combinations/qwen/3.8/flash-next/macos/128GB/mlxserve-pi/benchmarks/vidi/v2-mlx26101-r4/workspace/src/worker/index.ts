/**
 * The Worker: everything the product serves.
 *
 * Three kinds of request arrive. A `POST /api/boards` asks for a board and gets an address; a
 * `GET /api/boards/<board id>` asks whether there is a board at an address; and a WebSocket to
 * `/api/rooms/<board id>` is a person joining a board. All three go to that board's own room
 * object, which is what keeps one board's changes from ever appearing on another. Everything else
 * is the built client, served from static assets, including `/b/<board id>` — the board address
 * people open — which is the same `index.html` every time because the page decides what to show
 * from its own address.
 *
 * The two board routes share one rule: a board is looked for, never made. Only `POST /api/boards`
 * creates anything, and it creates exactly one board of its own, so the answers "is there a board
 * here" and "let me in" can be given from that board's storage without writing a row anywhere.
 */
import { isValidBoardId } from '../shared/board-id';
import { handleServe, handleUpload } from './assets';
import type { Env } from './board-room';
import { createBoard } from './create-board';
import { forwardTestHook, TEST_HOOK_PREFIX } from './test-hooks';

export type { Env };
export { BoardRoom } from './board-room';

/** Everything under this path is a board connection, and only ever one segment deep. */
const ROOM_PREFIX = '/api/rooms/';

/** The collection: the only way a board comes into existence. */
const BOARDS_PATH = '/api/boards';

/** One board, by its address. */
const BOARD_PREFIX = '/api/boards/';

/**
 * The pictures. `POST /api/boards/<board id>/assets` stores one, `GET /api/assets/<key>` hands one back.
 *
 * The upload address is a board address with `/assets` on the end, so it has to be recognised before the
 * board lookup runs — that lookup takes the rest of the path as the board id, and `<id>/assets` is not one.
 */
const ASSET_UPLOAD_SUFFIX = '/assets';

/** The whole of a picture's address is its key, so the prefix is the only routing left to do. */
const ASSET_PREFIX = '/api/assets/';

/** What a refused address says. The same words for unknown and malformed: nothing is leaked. */
const NOT_FOUND = { error: 'not_found' };

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const path = new URL(request.url).pathname;
    if (path === '/api/rooms' || path.startsWith(ROOM_PREFIX)) {
      return this.routeBoardConnection(request, env, path);
    }
    if (path === BOARDS_PATH) {
      return this.routeBoardCollection(request, env);
    }
    if (path.startsWith(BOARD_PREFIX)) {
      const uploading = assetUploadBoardId(path);
      if (uploading !== null) return this.routeAssetUpload(request, env, uploading);
      // An address under a board that reaches for `assets` and does not stop there is a picture address that
      // was written wrong. It gets the answer `assets.ts` gives for an address that leads nowhere — not a 405
      // from the board lookup, which would be an opinion about methods nobody asked for.
      if (namesAssets(path)) return Response.json(NOT_FOUND, { status: 404 });
      return this.routeBoardLookup(request, env, path);
    }
    if (path.startsWith(ASSET_PREFIX)) {
      return this.routeAssetServe(request, env, path);
    }
    if (path.startsWith(TEST_HOOK_PREFIX)) {
      // Damage and repair, for the tests that need to break a board on purpose. Without the
      // variable that mounts them, this falls through to the client, like any other address.
      return forwardTestHook(request, env, path);
    }
    return env.ASSETS.fetch(request);
  },

  /**
   * Make a board, and say what its address is.
   *
   * The only POST in this product, and the only request that creates anything. It carries no body
   * and no identity: a board is not made out of anything in particular, and the address it comes
   * back with is the only thing that will ever open it.
   */
  async routeBoardCollection(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      // There is no list of boards to fetch and nothing to update about one: the way to a board is
      // the link, and you either have it or you make a board.
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    const result = await createBoard(env);
    if (!result.ok) return Response.json({ error: result.reason }, { status: 500 });
    return Response.json({ id: result.id }, { status: 201 });
  },

  /**
   * Is there a board at this address?
   *
   * Asked once per page load by somebody following a link, so it is built to be answered without
   * writing: an id that is not one is turned away here, without so much as naming a room object,
   * which is what lets a stranger probe a thousand addresses and leave nothing behind.
   */
  async routeBoardLookup(request: Request, env: Env, path: string): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    const boardId = segmentAfter(path, BOARD_PREFIX) ?? '';
    if (!isValidBoardId(boardId)) {
      // Malformed and unknown give the same answer, for the same reason: the difference between
      // them says whether a link has been guessed correctly, and nothing here is going to say that.
      return Response.json(NOT_FOUND, { status: 404 });
    }
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    try {
      if (await room.exists()) return Response.json({ id: boardId });
    } catch (error) {
      // The board may or may not exist; what is certain is that this request cannot say. The
      // client is allowed to ask again, which is what it does.
      console.error(
        `check-board: could not ask about ${boardId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return Response.json({ error: 'check_failed' }, { status: 500 });
    }
    return Response.json(NOT_FOUND, { status: 404 });
  },

  /**
   * Store a picture for this board.
   *
   * Whether the address is a board at all, and whether the bytes are a picture this board can draw, are
   * answered in `assets.ts` — in that order, because the cheap question is asked first. What is decided here
   * is only which part of the address is the board.
   */
  routeAssetUpload(request: Request, env: Env, boardId: string): Promise<Response> {
    return handleUpload(request, env, boardId);
  },

  /**
   * Hand back a stored picture.
   *
   * The key is taken from the path as it was sent, without decoding: a key is made of characters that need no
   * escaping, so anything percent-escaped in it is not a key, and decoding it first would be a route that
   * reads a different object than the address named.
   */
  async routeAssetServe(request: Request, env: Env, path: string): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    const response = await handleServe(env, path.slice(ASSET_PREFIX.length));
    // A HEAD asks for the headers of a picture and not for the picture.
    if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
    return response;
  },

  /**
   * Hand a board connection to its room, or refuse it.
   *
   * A board address is the only thing that grants access to a board in this release, so an
   * address that is not one is refused here, before a room is named at all. Whether a *well-formed*
   * address belongs to a board is not knowable from here — it is written in that board's own
   * storage — so the room is asked, and the room refuses the connection itself rather than accept
   * one and serve an empty board. Both answers are 404, because to the person following a link
   * they are the same fact: there is nothing at that address.
   */
  routeBoardConnection(request: Request, env: Env, path: string): Promise<Response> | Response {
    const boardId = boardIdFromPath(path);
    if (boardId === null || !isValidBoardId(boardId)) {
      return Response.json(NOT_FOUND, { status: 404 });
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return new Response('This board address needs a WebSocket connection.', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    // One object per board address, chosen by that address: people on different
    // boards are in different objects and cannot see each other's changes; people
    // on the same address are in the same one. Nothing here counts them — the
    // product's capacity is a design target, and a sixth person is never refused.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
};

/**
 * Whether this board path reaches for the pictures at all.
 *
 * Only whole segments count, so an escaped slash cannot turn a board address into an assets address: that one
 * is a malformed board address, which is what the board lookup is for.
 */
function namesAssets(path: string): boolean {
  return path.slice(BOARD_PREFIX.length).split('/').includes(ASSET_UPLOAD_SUFFIX.slice(1));
}

/**
 * The board a picture is being uploaded to, or null when this path is not an upload.
 *
 * The id is returned as it was written, because a malformed one is a 404 that the upload handler gives for
 * its own reason — the same words as an unknown board, which is the rule the board lookup follows too.
 */
function assetUploadBoardId(path: string): string | null {
  const rest = path.slice(BOARD_PREFIX.length);
  if (!rest.endsWith(ASSET_UPLOAD_SUFFIX)) return null;
  const boardId = rest.slice(0, -ASSET_UPLOAD_SUFFIX.length);
  // Nothing after the suffix, and the id may be empty: `/api/boards//assets` names no board, and that is a
  // 404 the upload route gives for its own reason — not a 405 from the board lookup, which would be an
  // answer about a method nobody asked about.
  return boardId.includes('/') ? null : boardId;
}

/**
 * The board id in a connection path, or null when the path does not hold exactly
 * one. `%`-escapes are decoded because that is how a browser sends an address it
 * was given, and a path that cannot even be decoded is not an address either.
 */
function boardIdFromPath(path: string): string | null {
  return segmentAfter(path, ROOM_PREFIX);
}

/**
 * The one segment after a prefix, decoded, or null when there is not exactly one. A trailing
 * slash is not a second segment; an escaped slash inside a segment is.
 */
function segmentAfter(path: string, prefix: string): string | null {
  const segment = path.slice(prefix.length);
  if (segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
