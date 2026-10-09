import { isValidBoardId } from '../shared/board-id';
import { BoardRoom, armFailInitializeOnce, rpcCallCount } from './board-room';
import { createBoard } from './create-board';
import { parseTestHookBoardId } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  // Set to '1' only in test environments; production config never has it, so
  // the /__test/ routes fall through to the static assets (SPA/404).
  TEST_HOOKS?: string;
}

const ROOM_PREFIX = '/api/rooms/';
const BOARD_API_PREFIX = '/api/boards';

// Routes `/api/rooms/:boardId` to that board's BoardRoom and everything else
// to the static assets. `idFromName` gives every board its own object, which
// is what keeps boards separate (live.isolation). Nothing counts participants,
// so a 6th person on a board is never refused (live.over_capacity): the
// MAX_CONCURRENT_EDITORS setting is a design/test target, not an admission
// control.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__test/')) {
      if (env.TEST_HOOKS !== '1') return env.ASSETS.fetch(request);
      if (url.pathname === '/__test/fail-initialize') {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
        armFailInitializeOnce();
        return Response.json({ ok: true });
      }
      if (url.pathname === '/__test/rpc-calls') {
        const id = url.searchParams.get('id') ?? '';
        if (!isValidBoardId(id)) return new Response('invalid board id', { status: 400 });
        // idFromName is deterministic and does not instantiate the object, so
        // this read side effect-free proves how many RPC calls it received.
        const objectId = env.BOARD_ROOM.idFromName(id);
        return Response.json({ objectId: objectId.toString(), calls: rpcCallCount(objectId.toString()) });
      }
      const boardId = parseTestHookBoardId(url.pathname);
      if (boardId === null || !isValidBoardId(boardId)) {
        return new Response('invalid test route', { status: 400 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    if (url.pathname === BOARD_API_PREFIX || url.pathname.startsWith(`${BOARD_API_PREFIX}/`)) {
      return await handleBoardApi(request, url, env);
    }
    if (!url.pathname.startsWith(ROOM_PREFIX)) return env.ASSETS.fetch(request);
    const boardId = url.pathname.slice(ROOM_PREFIX.length);
    if (boardId.length === 0 || boardId.includes('/') || !isValidBoardId(boardId)) {
      return new Response('board not found', { status: 404 });
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  }
};

// share.board_api + share.not_found. POST creates exactly one fresh board and
// is the only entry point that writes new storage; GET reports whether a code
// names an existing board without creating anything. Anything naming a board
// that is not there answers 404, whether the id is well-formed or not.
async function handleBoardApi(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === BOARD_API_PREFIX) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const result = await createBoard(env);
    if (!result.ok) {
      return Response.json({ error: 'create_failed' }, { status: 500 });
    }
    return Response.json({ id: result.id }, { status: 201 });
  }
  const boardId = url.pathname.slice(BOARD_API_PREFIX.length + 1);
  if (boardId.length === 0 || boardId.includes('/') || !isValidBoardId(boardId)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ id: boardId }, { status: 200 });
}

export { BoardRoom };
