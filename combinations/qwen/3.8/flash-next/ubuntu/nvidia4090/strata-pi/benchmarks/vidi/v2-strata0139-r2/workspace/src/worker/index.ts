/**
 * Worker entry (`sync.worker_entry`).
 *
 * Two jobs, in this order:
 *
 *   1. `/api/rooms/:boardId` — the live board's WebSocket endpoint. A valid id
 *      is routed to *that board's* BoardRoom object (`idFromName`), so boards
 *      are separate: a change made on one board is never seen on another, and
 *      the room holds nothing but its own board's document.
 *   2. Everything else — the client build, served as static assets with an
 *      SPA fallback, so `/b/<boardId>` answers with index.html.
 *
 * Errors are answered before any object is touched: a malformed board id gets
 * 400 without ever creating a Durable Object instance, and a request that is
 * not a WebSocket upgrade gets 426.
 *
 * Participants are never counted here or in the room: MAX_CONCURRENT_EDITORS is
 * a design and test target, not a limit, so a 6th person is accepted like
 * anyone else.
 */

import { isValidBoardId } from "../shared/board-id";
import { BoardRoom } from "./board-room";

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PREFIX = "/api/rooms/";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (!pathname.startsWith(ROOM_PREFIX)) return env.ASSETS.fetch(request);

    const boardId = decodeURIComponent(pathname.slice(ROOM_PREFIX.length));
    if (!isValidBoardId(boardId)) {
      return new Response("Invalid board id", { status: 400 });
    }

    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("Upgrade Required", { status: 426 });
    }

    // One object per board id: isolation between boards is this routing.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
};

export { BoardRoom };
