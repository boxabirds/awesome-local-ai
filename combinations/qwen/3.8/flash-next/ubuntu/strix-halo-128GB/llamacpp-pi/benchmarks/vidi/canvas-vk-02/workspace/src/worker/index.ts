/**
 * Worker entry (design "sync.worker_entry").
 *
 * Two jobs and nothing else:
 *
 * - `/api/rooms/:boardId` with `Upgrade: websocket` is handed to the board's own
 *   Durable Object instance. `idFromName(boardId)` is what keeps boards apart:
 *   two different addresses never share an object, so no update can cross
 *   boards (`live.isolation`).
 * - Everything else is a static asset (the client, with SPA fallback).
 *
 * There is deliberately no participant counting and no connection limit: a
 * sixth person is never refused (`live.over_capacity`); the capacity setting is
 * a soft design and test target only.
 */

import { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  /** The board room namespace; one instance per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not the room API. */
  ASSETS: Fetcher;
}

// Anything under /api/rooms is the room API, including an empty or oddly
// shaped id: that is a bad address, not a page, so it must not fall through to
// the static assets.
const ROOM_PATH = /^\/api\/rooms\/(.*)$/;

function problem(boardId: string, status: number, detail: string): Response {
  // The address is echoed so a person pasting a broken link can see which part
  // the server rejected (the PRD's "tells me which part was wrong").
  return new Response(JSON.stringify({ error: `Invalid board id: ${boardId}`, detail }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = ROOM_PATH.exec(url.pathname);
    if (match === null) return env.ASSETS.fetch(request);

    let boardId: string;
    try {
      boardId = decodeURIComponent(match[1]);
    } catch {
      return Promise.resolve(problem(match[1], 400, 'the address is not valid UTF-8'));
    }
    // Shape only — the server has no idea whether a board "exists" until
    // story 4 persists it, and joining an empty board yields an empty board.
    if (!isValidBoardId(boardId)) {
      return Promise.resolve(problem(boardId, 400, 'expected 22 characters of [A-Za-z0-9_-]'));
    }

    const upgrade = (request.headers.get('upgrade') ?? '').trim().toLowerCase();
    if (upgrade !== 'websocket') {
      return Promise.resolve(problem(boardId, 426, 'this endpoint only accepts a websocket upgrade'));
    }

    const id = env.BOARD_ROOM.idFromName(boardId);
    return env.BOARD_ROOM.get(id).fetch(request);
  },
};

export { BoardRoom };
