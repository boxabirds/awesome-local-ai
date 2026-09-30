// Worker entry:
//   POST /api/boards          create a board (story 5)
//   GET  /api/boards/:id      does the board exist? 200 / 404 (unknown and malformed alike)
//   GET  /api/rooms/:id       WebSocket to that board's BoardRoom (404 for unknown boards)
//   POST /api/boards/:id/assets             upload an image (story 12)
//   GET  /api/assets/:boardId/:assetId      a stored image (story 12)
// Everything else goes to the static client (SPA fallback configured in wrangler.jsonc).
import { isValidBoardId } from '../shared/board-id';
import { handleServe, handleUpload } from './assets';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { TEST_HOOK_PATH, routeTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Uploaded images (story 12), keyed `<boardId>/<assetId>`. */
  ASSETS_BUCKET: R2Bucket;
  /** '1' only in the e2e `wrangler dev` (enables src/worker/test-hooks.ts); never set in production. */
  TEST_HOOKS?: string;
}

const BOARDS_PATH = /^\/api\/boards\/?$/;
const BOARD_PATH = /^\/api\/boards\/([^/]*)\/?$/;
const ROOM_PATH = /^\/api\/rooms\/([^/]*)\/?$/;
const BOARD_ASSETS_PATH = /^\/api\/boards\/([^/]*)\/assets\/?$/;
const ASSET_PREFIX = '/api/assets/';

/** The board id from a path segment, or null when it is not a well-formed id. */
function boardIdFrom(segment: string): string | null {
  try {
    const id = decodeURIComponent(segment);
    return isValidBoardId(id) ? id : null;
  } catch {
    return null;
  }
}

const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });
const methodNotAllowed = (allow: string) =>
  Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: allow } });

function stubFor(env: Env, boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(TEST_HOOK_PATH) && env.TEST_HOOKS === '1') return routeTestHook(req, env);

    if (BOARDS_PATH.test(url.pathname)) {
      if (req.method !== 'POST') return methodNotAllowed('POST');
      const result = await createBoard(env);
      return result.ok
        ? Response.json({ id: result.id }, { status: 201 })
        : Response.json({ error: result.reason }, { status: 500 });
    }

    const upload = BOARD_ASSETS_PATH.exec(url.pathname);
    if (upload) {
      if (req.method !== 'POST') return methodNotAllowed('POST');
      return handleUpload(req, env, boardIdFrom(upload[1]) ?? '');
    }
    if (url.pathname.startsWith(ASSET_PREFIX)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
      let key: string;
      try {
        key = decodeURIComponent(url.pathname.slice(ASSET_PREFIX.length));
      } catch {
        return notFound();
      }
      return handleServe(env, key);
    }

    const board = BOARD_PATH.exec(url.pathname);
    if (board) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
      // Malformed ids never reach a Durable Object.
      const boardId = boardIdFrom(board[1]);
      if (!boardId) return notFound();
      return (await stubFor(env, boardId).exists()) ? Response.json({ id: boardId }) : notFound();
    }

    const room = ROOM_PATH.exec(url.pathname);
    if (!room) return env.ASSETS.fetch(req);
    const boardId = boardIdFrom(room[1]);
    if (!boardId) return new Response('Not Found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    // One object per board keeps boards separate; nobody is counted or refused (soft capacity).
    // The room itself answers 404 for a board that does not exist.
    return stubFor(env, boardId).fetch(req);
  },
} satisfies ExportedHandler<Env>;
