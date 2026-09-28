// Worker entry (story 3). Routes /api/rooms/:boardId WebSocket upgrades to the
// BoardRoom Durable Object for that board; everything else falls through to the
// static-asset fetcher (SPA fallback comes from the assets config). The board id
// is validated BEFORE any Durable Object is touched, so an invalid id can never
// instantiate a room (PRD live.isolation / TC-04). There is deliberately no
// connection/participant count check: capacity is soft and never enforced.
// Worker entry (stories 3-5). Routes:
//   POST /api/boards          create a board (rate limited per visitor)
//   GET  /api/boards/:id      does this board exist?
//   GET  /api/rooms/:id       WebSocket upgrade to that board's room
// and falls through to the static-asset fetcher for everything else (the SPA
// fallback comes from the assets config). The board id is validated BEFORE any
// Durable Object is touched, so an invalid id can never instantiate a room (PRD
// live.isolation / TC-04) and a malformed link leaks nothing. There is
// deliberately no connection/participant count check: capacity is soft and never
// enforced.
import { isValidBoardId } from '../shared/board-id.ts';
import { createBoard, createResponse, notFoundResponse } from './create-board.ts';
import { BoardRoom } from './board-room.ts';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /**
   * One board per visitor per period: the numbers live in `src/shared/config.ts`
   * and `wrangler.jsonc` mirrors them (TC-03 keeps them equal).
   */
  BOARD_CREATE_LIMITER: RateLimit;
  ASSETS: Fetcher;
  /**
   * '1' in the test worker and in `wrangler dev --var TEST_HOOKS:1` only.
   * Gates the /__test/... failure-injection routes; production never sets it,
   * so those paths 404 (and the DO refuses them too, independently).
   */
  TEST_HOOKS?: string;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/]+)\/?$/;
const BOARDS_COLLECTION = /^\/api\/boards\/?$/;
const BOARD_ITEM = /^\/api\/boards\/([^/]+)\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    // Failure injection, present only in a test worker. The id is validated
    // here too, so an invalid id still cannot instantiate a room.
    if (env.TEST_HOOKS === '1') {
      const test = TEST_BOARD_ROUTE.exec(path);
      if (test) return testHook(env, test, request);
    }

    if (BOARDS_COLLECTION.test(path)) {
      return createBoardHandler(env, request);
    }

    const board = BOARD_ITEM.exec(path);
    if (board) return existBoardHandler(env, request, board[1]);

    const match = ROOM_ROUTE.exec(path);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        // 404 before idFromName/get: no object instance is created, and the
        // answer is exactly the one an uncreated code gets, so probing links
        // learns nothing about what a valid code looks like.
        return notFoundResponse();
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

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * Who a creation is charged to: the connecting IP, so one visitor cannot make
 * unlimited boards (PRD share.rate_limit). A request that carries no IP - a
 * local run, or a proxy that stripped it - is charged to one shared bucket,
 * which is the strictest reading and never the loosest.
 */
function visitorKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown-visitor';
}

// POST /api/boards -> 201 {id} | 429 rate_limited | 500 create_failed.
// Anything else on the collection is not a thing this API does.
async function createBoardHandler(env: Env, request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const result = await createBoard(
    { BOARD_ROOM: env.BOARD_ROOM, BOARD_CREATE_LIMITER: env.BOARD_CREATE_LIMITER },
    visitorKey(request),
  );
  // One place decides what each outcome is worth to the visitor.
  return createResponse(result);
}

// GET /api/boards/:id -> 200 {id} | 404 not_found. A malformed code is answered
// here, without touching the namespace, with exactly the body and status an
// uncreated one gets: checking links cannot learn what a real code looks like.
async function existBoardHandler(env: Env, request: Request, boardId: string): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }
  if (!isValidBoardId(boardId)) return notFoundResponse();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  return exists ? json({ id: boardId }, 200) : notFoundResponse();
}

// The failure-injection surface used by the end-to-end persistence tests:
//   POST /__test/boards/:id/ensure             create the board (test fixture)
//   POST /__test/boards/:id/sql              body = {sql, bindings?}: the rows a statement returns
//   POST /__test/boards/:id/sql              body = {sql, bindings?}: read a statement's rows
//   POST /__test/boards/:id/seed             body = one Yjs update
//   POST /__test/boards/:id/compact
//   POST /__test/boards/:id/corrupt-snapshot
//   POST /__test/boards/:id/repair-snapshot
//   POST /__test/boards/:id/reload
//   GET  /__test/boards/:id/state
const TEST_BOARD_ROUTE = /^\/__test\/boards\/([^/]+)\/(compact|corrupt-snapshot|ensure|reload|repair-snapshot|seed|sql|state)$/;

async function testHook(
  env: Env,
  match: RegExpMatchArray,
  request: Request,
): Promise<Response> {
  const boardId = match[1];
  if (!isValidBoardId(boardId)) {
    // A test hook is not a way to reach an object that the real routes refuse.
    return notFoundResponse();
  }
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
  return stub.fetch(
    new Request(`https://room/__test/${match[2]}`, {
      method: request.method,
      body,
      // `/__test/boards/:id/sql` takes a JSON statement; the other hooks read raw
      // bytes and ignore this header.
      headers: { 'content-type': 'application/json' },
    }),
  );
}
