/**
 * The Worker entry: the only thing between a browser and a board.
 *
 * Three jobs, and nothing else.
 *
 * - `/api/boards` creates a board (story 5). `POST` gives the new board its address and
 *   makes it exist; `GET /api/boards/<boardId>` answers whether an address names one.
 *   Both are the only ways a board is made or measured, and neither is reached by
 *   opening a page: `BoardPage` asks before it shows a board, so a mistyped link says
 *   "Board not found" instead of looking like a board whose contents were deleted.
 * - `/api/rooms/<boardId>` with a WebSocket upgrade goes to that board's `BoardRoom`.
 *   `idFromName(boardId)` is what keeps boards separate (`live.isolation`): every
 *   connection for one address lands in the same object, which holds only that board's
 *   document and talks only to its own sockets. An address that is not a board gets a
 *   404 from the room itself — the object cannot be made by connecting to it.
 * - everything else goes to the built client (`dist/client`), which handles its own
 *   routes (`/`, `/b/<boardId>`) in the browser.
 *
 * A malformed id is answered here, before the namespace is touched, so nothing about a
 * string that cannot name a board can cost an object. An unknown-but-well-formed id is
 * answered by the room, which is the only thing that can see its storage. Neither is
 * distinguished from the other on purpose: a 404 for both tells a stranger nothing
 * about which addresses exist.
 *
 * Nobody is counted anywhere. The product's `MAX_CONCURRENT_EDITORS` is a design
 * and test target, so a 6th person is accepted exactly like anyone else
 * (`live.over_capacity`).
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { testHooksEnabled } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * `1` routes the `/__test/boards/:boardId/...` endpoints, which exist so a test can
   * break a board on purpose (see `src/worker/test-hooks.ts`). Absent everywhere else:
   * without it the path is not routed at all, and the room refuses it a second time.
   */
  TEST_HOOKS?: string;
}

const ROOM_PATH = '/api/rooms';
const ROOM_PREFIX = `${ROOM_PATH}/`;
const BOARDS_PATH = '/api/boards';
const BOARD_PREFIX = `${BOARDS_PATH}/`;
const TEST_HOOK_PREFIX = '/__test/boards/';

/** Case-insensitive `Upgrade: websocket`, as the fetch spec says to check it. */
function wantsWebSocket(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '').toLowerCase().includes('websocket');
}

/** An address that names no board. The same response for "not valid" and "not made". */
function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}

/** The method the path does take, so a client reading the error is not left guessing. */
function methodNotAllowed(allow: string): Response {
  return new Response(null, { status: 405, headers: { Allow: allow } });
}

/** `POST /api/boards` and `GET /api/boards/:id`, per the HTTP contract. */
async function handleBoards(request: Request, env: Env, pathname: string): Promise<Response> {
  if (pathname === BOARDS_PATH) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const created = await createBoard(env);
    if (!created.ok) return Response.json({ error: created.reason }, { status: 500 });
    return Response.json({ id: created.id }, { status: 201 });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET');

  let boardId = pathname.slice(BOARD_PREFIX.length);
  try {
    boardId = decodeURIComponent(boardId);
  } catch {
    // A percent-encoding that does not decode is not an address, and says nothing more.
    return notFound();
  }
  // Checked before the namespace so a string that cannot name a board never makes an
  // object, and never makes the room's storage answer a question about itself.
  if (!isValidBoardId(boardId)) return notFound();

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return (await stub.exists()) ? Response.json({ id: boardId }) : notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // A board's storage belongs to its own object, so even a test that wants to damage
    // it has to ask that object. The path is `/__test/boards/<boardId>/<action>`; the
    // room parses the action and checks `TEST_HOOKS` again.
    if (testHooksEnabled(env) && pathname.startsWith(TEST_HOOK_PREFIX)) {
      const boardId = pathname.slice(TEST_HOOK_PREFIX.length).split('/')[0] ?? '';
      if (!isValidBoardId(boardId)) return new Response('invalid board id', { status: 400 });
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
    }

    if (pathname === BOARDS_PATH || pathname.startsWith(BOARD_PREFIX)) {
      return handleBoards(request, env, pathname);
    }

    if (pathname !== ROOM_PATH && !pathname.startsWith(ROOM_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    const boardId = pathname.slice(ROOM_PREFIX.length);
    if (!isValidBoardId(boardId)) {
      // 404 rather than story 3's 400: from outside, an address that cannot name a
      // board and an address that names none are the same fact (share.not_found).
      return notFound();
    }
    if (!wantsWebSocket(request)) {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};

export { BoardRoom };
