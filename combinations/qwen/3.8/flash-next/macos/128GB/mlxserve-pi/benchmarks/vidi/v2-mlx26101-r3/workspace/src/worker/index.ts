import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
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

/** True when the request is a websocket upgrade (the header is case-insensitive). */
function isUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

/** The board id in a `/api/rooms/...` pathname, or `null` when there is not one. */
function boardIdIn(pathname: string): string | null {
  const match = ROOM_PATH.exec(pathname);
  const raw = match?.[1];
  if (raw === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const boardId = boardIdIn(pathname);
    if (boardId === null) {
      // The test switches are the only other thing this Worker knows how to route, and only when
      // this deployment was started with them turned on.
      const switched = areEnabled(env) ? testSwitchIn(pathname) : null;
      if (switched === null) {
        return env.ASSETS.fetch(request);
      }
      if (request.method !== 'POST') {
        return new Response('Use POST', { status: 405 });
      }
      // The same rule as for a connection: an id nobody could guess is the whole access control, so
      // anything else is refused here and never creates a Durable Object.
      if (!isValidBoardId(switched.boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(switched.boardId));
      return room.fetch(
        new Request(`https://room.internal/internal/test/${switched.step}`, { method: 'POST' }),
      );
    }
    // An id nobody could guess is the whole access control of story 3; anything else is
    // refused here, so it never reaches - and never creates - a Durable Object.
    if (!isValidBoardId(boardId)) {
      return new Response('Invalid board id', { status: 400 });
    }
    if (!isUpgrade(request)) {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
