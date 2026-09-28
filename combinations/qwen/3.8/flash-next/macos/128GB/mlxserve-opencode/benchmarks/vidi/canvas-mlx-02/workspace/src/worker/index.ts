// Worker entry (story 3). Routes /api/rooms/:boardId WebSocket upgrades to the
// BoardRoom Durable Object for that board; everything else falls through to the
// static-asset fetcher (SPA fallback comes from the assets config). The board id
// is validated BEFORE any Durable Object is touched, so an invalid id can never
// instantiate a room (PRD live.isolation / TC-04). There is deliberately no
// connection/participant count check: capacity is soft and never enforced.
import { isValidBoardId } from '../shared/board-id.ts';
import { BoardRoom } from './board-room.ts';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * '1' in the test worker and in `wrangler dev --var TEST_HOOKS:1` only.
   * Gates the /__test/... failure-injection routes; production never sets it,
   * so those paths 404 (and the DO refuses them too, independently).
   */
  TEST_HOOKS?: string;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/]+)\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    // Failure injection, present only in a test worker. The id is validated
    // here too, so an invalid id still cannot instantiate a room.
    if (env.TEST_HOOKS === '1') {
      const test = TEST_BOARD_ROUTE.exec(path);
      if (test) return testHook(env, test, request);
    }

    const match = ROOM_ROUTE.exec(path);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        // 400 before idFromName/get: no object instance is created.
        return new Response('Invalid board id', { status: 400 });
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      // One Durable Object per board id: this is what isolates boards.
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

// The failure-injection surface used by the end-to-end persistence tests:
//   POST /__test/boards/:id/seed             body = one Yjs update
//   POST /__test/boards/:id/compact
//   POST /__test/boards/:id/corrupt-snapshot
//   POST /__test/boards/:id/repair-snapshot
//   POST /__test/boards/:id/reload
//   GET  /__test/boards/:id/state
const TEST_BOARD_ROUTE = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|reload|repair-snapshot|seed|state)$/;

async function testHook(
  env: Env,
  match: RegExpMatchArray,
  request: Request,
): Promise<Response> {
  const boardId = match[1];
  if (!isValidBoardId(boardId)) {
    return new Response('Invalid board id', { status: 400 });
  }
  const id = env.BOARD_ROOM.idFromName(boardId);
  const stub = env.BOARD_ROOM.get(id);
  const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
  return stub.fetch(
    new Request(`https://room/__test/${match[2]}`, {
      method: request.method,
      body,
    }),
  );
}
