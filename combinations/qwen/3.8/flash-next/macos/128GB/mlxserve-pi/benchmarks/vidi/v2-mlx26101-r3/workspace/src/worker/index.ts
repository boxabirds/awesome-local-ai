import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
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
 * Story 5 adds two small routes in front of that, because from this story a board is made
 * rather than arrived at: `POST /api/boards` makes one and hands back its id, and
 * `GET /api/boards/:id` answers whether a link leads to one. Both are answered by the board's
 * own object, since nothing outside a Durable Object can see its storage.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
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
