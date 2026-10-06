/**
 * Worker entry (`sync.worker_entry`, `share.board_api`).
 *
 * Three jobs, in this order:
 *
 *   1. `/api/boards` — the board API. `POST` creates a board (one 128-bit random
 *      id plus one `initialize()` RPC) and answers `201 {"id": …}`; `GET` asks
 *      whether a board exists and answers `200` or `404`. Creation happens here,
 *      nowhere else: a board is never brought into being by opening an address.
 *   2. `/api/rooms/:boardId` — the live board's WebSocket endpoint. A valid id
 *      is routed to *that board's* BoardRoom object (`idFromName`), so boards are
 *      separate. An id that is malformed, or valid but not a board, is a 404
 *      *before* a socket is accepted and *before* anything is written.
 *   3. Everything else — the client build, served as static assets with an SPA
 *      fallback, so `/b/<boardId>` answers with index.html.
 *
 * Errors are answered before any object is touched: `isValidBoardId` is checked
 * first, so a mistyped link never instantiates a Durable Object (TC-07), and the
 * existence check is read-only, so probing a link leaves no storage behind
 * (TC-06, TC-09). Unknown and malformed ids get the same 404 with the same body:
 * the API does not tell a probing person which of the two it was.
 *
 * Participants are never counted here or in the room: MAX_CONCURRENT_EDITORS is
 * a design and test target, not a limit, so a 6th person is accepted like anyone
 * else.
 */

import { isValidBoardId } from "../shared/board-id";
import { BoardRoom } from "./board-room";
import { createBoard } from "./create-board";
import { handleTestHook, TEST_HOOKS_PREFIX } from "./test-hooks";

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Set to "1" only by the e2e servers (`npm run serve:e2e`,
   * `npm run test:e2e:persistence`). It enables `src/worker/test-hooks.ts`; a
   * production deploy never sets it, and without it those routes are 404s.
   */
  TEST_HOOKS?: string;
}

const ROOM_PREFIX = "/api/rooms/";
const BOARDS_PATH = "/api/boards";
const NOT_FOUND_BODY = JSON.stringify({ error: "not_found" });

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith(TEST_HOOKS_PREFIX)) {
      const hooked = await handleTestHook(request, env, pathname);
      // No test hooks in this Worker: the route does not exist.
      return hooked ?? json({ error: "not_found" }, 404);
    }

    if (pathname === BOARDS_PATH) return handleCreateBoard(request, env);

    if (pathname.startsWith(`${BOARDS_PATH}/`)) {
      return handleCheckBoard(request, env, pathname.slice(BOARDS_PATH.length + 1));
    }

    if (pathname.startsWith(ROOM_PREFIX)) {
      return handleRoom(request, env, pathname.slice(ROOM_PREFIX.length));
    }

    return env.ASSETS.fetch(request);
  },
};

/** `POST /api/boards` → 201 {id}. Anything else on this path is 405. */
async function handleCreateBoard(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  const result = await createBoard(env);
  if (!result.ok) return json({ error: "create_failed" }, 500);
  return json({ id: result.id }, 201);
}

/**
 * `GET /api/boards/:id` → 200 {id} or 404.
 *
 * A malformed id is answered without consulting the namespace at all, and a
 * valid-but-unknown id is answered by a read-only RPC. Neither writes anything,
 * which is what makes "Board not found" safe to hand out (share.not_found).
 */
async function handleCheckBoard(request: Request, env: Env, rawId: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();

  const boardId = decodeBoardId(rawId);
  if (boardId === null || !isValidBoardId(boardId)) return notFound();

  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  if (!exists) return notFound();
  return json({ id: boardId }, 200);
}

/** `/api/rooms/:boardId` — the live board's WebSocket endpoint. */
async function handleRoom(request: Request, env: Env, rawId: string): Promise<Response> {
  const boardId = decodeBoardId(rawId);
  // Story 3 answered 400 here; story 5's contract is one 404 for every id that
  // does not name a board, malformed included (TC-09, share.not_found).
  if (boardId === null || !isValidBoardId(boardId)) return notFound();

  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return new Response("Upgrade Required", { status: 426 });
  }

  // One object per board id: isolation between boards is this routing.
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
}

/** Percent-decodes an id segment, refusing one whose escapes are not valid UTF-8. */
function decodeBoardId(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function notFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "GET, POST" },
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export { BoardRoom };
