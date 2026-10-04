import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleServe, handleUpload } from './assets';
import { areEnabled, testSwitchIn } from './test-hooks';

/**
 * The Worker entry: the only two jobs it has are to point a board's websocket at that
 * board's {@link BoardRoom}, and to serve the client for everything else.
 *
 * `idFromName(boardId)` is what keeps boards separate (live.isolation): every connection
 * for a board lands on the same object, and that object holds only that board's document
 * and talks only to its own sockets. Nothing here counts participants, so a 6th person on
 * a board is accepted exactly like the first five (live.over_capacity) -
 * MAX_CONCURRENT_EDITORS is a design and test target, never a limit.
 *
 * Story 5 adds two small routes in front of that, because from this story a board is made rather than
 * arrived at: `POST /api/boards` makes one and hands back its id, and `GET /api/boards/:id` answers
 * whether a link leads to one. Both are answered by the board's own object, since nothing outside a
 * Durable Object can see its storage.
 *
 * Story 12 adds two more, for the one kind of thing a board's document cannot hold: the bytes of a
 * picture. `POST /api/boards/:id/assets` keeps them and `GET /api/assets/:boardId/:assetId` gives them
 * back, both answered in `assets.ts` and both deciding what they were given from the bytes rather than
 * from anybody's say-so.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Where the pictures are kept (story 12). Every board's assets share this one bucket and are told apart
   * by the board id their key starts with, which is why the key is checked before the bucket is ever read.
   *
   * Optional because a Worker can be asked to run without one - a deployment made before this story, an
   * integration test that only talks to rooms - and the answer to an upload then is `500 storage_failed`,
   * which is what is true, rather than a type error at build time or an exception on the way to a board
   * that never wanted to upload anything.
   */
  ASSETS_BUCKET?: R2Bucket;
  /**
   * `1` turns on the test switches in `test-hooks.ts`. Set only on the development server the e2e
   * suite starts; absent from this file, from the preview server and from any deployment, which is
   * what makes a request to `/__test/...` in production be an unknown path rather than a way to
   * damage a board.
   */
  TEST_HOOKS?: string;
}

/** `/api/rooms/<boardId>` - the websocket endpoint of one board. */
const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

/** `/api/boards` - make a board (story 5, share.create). */
const BOARDS_PATH = /^\/api\/boards$/;

/** `/api/boards/<boardId>` - is there a board behind this link? (share.not_found). */
const BOARD_PATH = /^\/api\/boards\/([^/]+)$/;

/** `/api/boards/<boardId>/assets` - keep a picture that belongs to a board (story 12, image.types). */
const BOARD_ASSETS_PATH = /^\/api\/boards\/([^/]+)\/assets$/;

/**
 * `/api/assets/<boardId>/<assetId>` - the bytes of one picture (story 12, image.shared).
 *
 * Both halves are matched as separate segments, so a path with a third of them is not a key at all and
 * reaches the static assets instead. What the two are joined back into is what {@link ASSET_KEY_PATTERN}
 * is checked against in `assets.ts`: the route says where a key may appear, the pattern says what one is.
 */
const ASSET_PATH = /^\/api\/assets\/([^/]+)\/([^/]+)$/;

/** True when the request is a websocket upgrade (the header is case-insensitive). */
function isUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/** The board id in a `/api/rooms/...` pathname, or `null` when there is not one. */
function boardIdIn(pathname: string): string | null {
  const match = ROOM_PATH.exec(pathname);
  return pathSegment(match?.[1]);
}

/** The board id in a `/api/boards/...` pathname, or `null` when there is not one. */
function askedBoardIn(pathname: string): string | null {
  const match = BOARD_PATH.exec(pathname);
  return match === null ? null : pathSegment(match[1]);
}

/** The board id in a `/api/boards/<id>/assets` pathname, or `null` when there is not one. */
function uploadTargetIn(pathname: string): string | null {
  const match = BOARD_ASSETS_PATH.exec(pathname);
  return match === null ? null : pathSegment(match[1]);
}

/** The asset key in a `/api/assets/...` pathname, or `null` when there is not one. */
function assetKeyIn(pathname: string): string | null {
  const match = ASSET_PATH.exec(pathname);
  if (match === null) {
    return null;
  }
  const boardId = pathSegment(match[1]);
  const assetId = pathSegment(match[2]);
  // A segment that could not be decoded is not part of a key, and the two halves are joined here rather
  // than matched as one so that a `%2F` in either has already become a slash by the time the pattern sees
  // it - and the pattern, which allows exactly one, says no.
  return boardId === null || assetId === null ? null : `${boardId}/${assetId}`;
}

/** A percent-encoded path segment, decoded, or `null` when it cannot be decoded at all. */
function pathSegment(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** A JSON answer, with the headers that say so. */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    // The test switches are the only other thing this Worker knows how to route, and only when
    // this deployment was started with them turned on.
    const switched = areEnabled(env) ? testSwitchIn(pathname) : null;
    if (switched !== null) {
      if (request.method !== 'POST') {
        return new Response('Use POST', { status: 405 });
      }
      // The same rule as for a connection: an id nobody could guess is the whole access control, so
      // anything else is refused here and never creates a Durable Object.
      if (!isValidBoardId(switched.boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(switched.boardId));
      // A step that has to be told what to write is told in the body, which is read here and sent on
      // as it arrived: the room is addressed by this Worker rather than by whoever asked, so it gets
      // what was sent rather than somebody else's stream.
      const body = await request.arrayBuffer();
      return room.fetch(
        new Request(`https://room.internal/internal/test/${switched.step}`, {
          method: 'POST',
          ...(body.byteLength > 0
            ? { body, headers: { 'content-type': 'application/json' } }
            : {}),
        }),
      );
    }

    // `POST /api/boards`: a board, and the id its link will be built from. Nothing about the id is
    // chosen here beyond "random", and the board is created before a link to it exists - which is
    // what lets every other route answer "no board here" about a link nobody issued.
    if (BOARDS_PATH.test(pathname)) {
      if (request.method !== 'POST') {
        // There is no list of boards at this address to read, change or clear: boards are handed out
        // one at a time, and never enumerated by whoever asks.
        return json({ error: 'method_not_allowed' }, 405);
      }
      const created = await createBoard(env);
      return created.ok ? json({ id: created.id }, 201) : json({ error: created.reason }, 500);
    }

    // `GET /api/boards/<id>`: the question a pasted link asks. It is asked of the board's own
    // object, and answered from storage without writing to it.
    const asked = askedBoardIn(pathname);
    if (asked !== null) {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      // A link that is not a code is answered here, without touching a namespace: the object that
      // would be asked does not exist and should not be made just to be told no. The body and status
      // are the ones a board that was never made gets too, so this route cannot be used to find out
      // which of a dozen links are real.
      if (!isValidBoardId(asked)) {
        return json({ error: 'not_found' }, 404);
      }
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(asked));
      try {
        return (await room.exists()) ? json({ id: asked }) : json({ error: 'not_found' }, 404);
      } catch (error) {
        // The board may perfectly well be there; what failed was asking. "Not found" would be an
        // answer the client acts on by giving up, so this says what actually happened instead.
        console.error(`board ${asked}: could not be checked (${String(error)})`);
        return json({ error: 'check_failed' }, 500);
      }
    }

    // `POST /api/boards/<id>/assets`: a picture for a board. The body is the file and the answer is the key
    // its bytes will be served by, which is decided here from the bytes and nowhere else.
    const uploadTo = uploadTargetIn(pathname);
    if (uploadTo !== null) {
      if (request.method !== 'POST') {
        // Nothing to list and nothing to read: the only thing this address does with a request is store
        // what the request carries.
        return json({ error: 'method_not_allowed' }, 405);
      }
      return handleUpload(request, env, uploadTo);
    }

    // `GET /api/assets/<boardId>/<assetId>`: the bytes themselves, with the headers that make it safe to
    // hand a file somebody chose to a browser. This is what an <img> on the board points at, and the route
    // story 17 will read from to put the same pictures in an exported document.
    const assetKey = assetKeyIn(pathname);
    if (assetKey !== null) {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      return handleServe(env, assetKey);
    }

    const boardId = boardIdIn(pathname);
    if (boardId !== null) {
      // A code that is not a code gets the same answer as a board that was never made: this is what
      // a mistyped or mangled link runs into, and the client turns it into "Board not found"
      // (share.not_found) without ever learning which of the two it met.
      if (!isValidBoardId(boardId)) {
        return json({ error: 'not_found' }, 404);
      }
      if (!isUpgrade(request)) {
        return new Response('Upgrade Required', { status: 426 });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
