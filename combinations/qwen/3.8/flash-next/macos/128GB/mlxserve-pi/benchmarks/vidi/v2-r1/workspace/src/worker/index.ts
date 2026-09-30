// Copyright 2026 Board Room contributors. All rights reserved.
//
// Entry point of the Worker: it decides whether a request is a live board
// connection or a request for the client, and forwards it. It holds no state
// and enforces no limits.
//
// Routing:
//   /api/rooms/:boardId  -> the BoardRoom Durable Object for that board
//   /__test/boards/...    -> the story 4 test hooks, and only when this Worker
//                            was run with TEST_HOOKS=1 (see src/worker/test-hooks.ts)
//   everything else      -> static assets, which serve the app shell for
//                           `/b/<boardId>` (`assets.not_found_handling =
//                           "single-page-application"` in `wrangler.jsonc`)
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
import type { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';
import { handleTestHook } from './test-hooks';
import { createBoard } from './create-board';

/** What this Worker is wired to: one room object namespace and the client assets. */
export interface Env {
  /** One BoardRoom per board; the board id is the object's name. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client assets. */
  ASSETS: Fetcher;
  /**
   * Set to `1` by the story 4 e2e suite's own `wrangler dev` and by nothing else
   * — no committed configuration sets it, so a deployed Worker never serves the
   * test hooks.
   */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms(?:\/([^/?#]*))?$/;

/** The collection path: POST here creates a board (share.board_api). */
const BOARDS_PATH = '/api/boards';

/** /api/boards/:id — GET here asks whether the board exists. */
const BOARD_PATH = /^\/api\/boards\/([^/?#]+)$/;

/** The only header the routing decision depends on. */
const isWebSocketUpgrade = (request: Request): boolean =>
  (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';

const jsonError = (
  status: number,
  code: string,
  message: string,
): Response =>
  Response.json(
    // The board id is deliberately not echoed: an address that is wrong is
    // wrong, and repeating it back would put untrusted text into whatever
    // shows this to a person.
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

/** A small JSON answer for the board API, `no-store` like every /api/ reply. */
const json = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The one answer for "this board is not here", malformed or unknown alike
 * (share.not_found, TC-32). */
const notFound = (): Response => json({ error: 'not_found' }, 404);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Before anything else, so that a hook cannot be shadowed by an asset. When
    // the flag is not set this answers null, and the request goes on unchanged.
    if (env.TEST_HOOKS === '1') {
      const hooked = await handleTestHook(request, env);
      if (hooked !== null) return hooked;
    }

    // The board API (share.board_api): creating a board and asking whether one
    // exists. Both are plain HTTP under /api/, so the SPA asset fallback never
    // sees them. They are matched before the room path so `/api/boards` is never
    // mistaken for a room.
    if (pathname === BOARDS_PATH) {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      const created = await createBoard(env);
      if (created.ok) {
        return json({ id: created.id }, 201);
      }
      console.error('[vidi6] board could not be created', { reason: created.reason });
      return json({ error: 'create_failed' }, 500);
    }

    const boardMatch = BOARD_PATH.exec(pathname);
    if (boardMatch !== null) {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      const id = decodeURIComponent(boardMatch[1]!);
      // A malformed address is not a board, and the object is never woken for it
      // (share.not_found). Same 404 as an unknown id (TC-32).
      if (!isValidBoardId(id)) {
        return notFound();
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
      try {
        // Durable Object RPC: read-only, it neither creates tables, loads a
        // document nor opens a socket (TC-06).
        return (await stub.exists()) ? json({ id }, 200) : notFound();
      } catch (error) {
        // Only 200/404 mean exists/does-not-exist to the client; anything else
        // — a 500 — is "could not reach the service" (share.existing_link).
        console.error('[vidi6] board existence check failed', { error: String(error) });
        return json({ error: 'lookup_failed' }, 500);
      }
    }

    const match = ROOM_PATH.exec(pathname);
    if (match === null) {
      // Everything that is not a live connection is the client. `index.html`
      // is served for extension-less paths by the assets bundle, which is what
      // makes a pasted `/b/<boardId>` link open the app.
      return env.ASSETS.fetch(request);
    }

    const boardId = match[1] ?? '';
    // A malformed address is not a board (share.not_found). Story 3 answered it
    // with 400; nobody ever types a board address, so there is no request to
    // explain, and 404 is the honest answer — the same one an unknown id gets
    // (TC-32).
    if (!isValidBoardId(boardId)) {
      return notFound();
    }
    if (!isWebSocketUpgrade(request)) {
      return Promise.resolve(
        jsonError(
          426,
          'websocket_upgrade_required',
          'Connect to this room with `Upgrade: websocket`.',
        ),
      );
    }

    // One object per board id (`live.isolation`): this is the only place the
    // namespace is touched, so an invalid id never creates an object. There is
    // no participant counting anywhere in this file — `live.over_capacity`.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};

export { BoardRoom } from './board-room';
