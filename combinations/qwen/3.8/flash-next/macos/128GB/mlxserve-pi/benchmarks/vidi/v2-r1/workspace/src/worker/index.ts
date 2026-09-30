// Copyright 2026 Board Room contributors. All rights reserved.
//
// Entry point of the Worker: it decides whether a request is a live board
// connection or a request for the client, and forwards it. It holds no state
// and enforces no limits.
//
// Routing:
//   /api/rooms/:boardId  -> the BoardRoom Durable Object for that board
//   everything else      -> static assets, which serve the app shell for
//                           `/b/<boardId>` (`assets.not_found_handling =
//                           "single-page-application"` in `wrangler.jsonc`)
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
import type { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

/** What this Worker is wired to: one room object namespace and the client assets. */
export interface Env {
  /** One BoardRoom per board; the board id is the object's name. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client assets. */
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms(?:\/([^/?#]*))?$/;

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

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const match = ROOM_PATH.exec(pathname);
    if (match === null) {
      // Everything that is not a live connection is the client. `index.html`
      // is served for extension-less paths by the assets bundle, which is what
      // makes a pasted `/b/<boardId>` link open the app.
      return env.ASSETS.fetch(request);
    }

    const boardId = match[1] ?? '';
    if (!isValidBoardId(boardId)) {
      return Promise.resolve(
        jsonError(400, 'invalid_board_id', 'That is not a board address.'),
      );
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
