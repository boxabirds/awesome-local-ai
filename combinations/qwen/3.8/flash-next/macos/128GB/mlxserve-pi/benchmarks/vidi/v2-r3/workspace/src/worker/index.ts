// The Worker entry: it routes the live-board socket to that board's Durable
// Object and everything else to the static client.
//
// Boards stay separate (live.isolation): `idFromName(boardId)` sends every
// connection for one address to that board's own BoardRoom object, which
// holds only that board's document and broadcasts only to its own sockets.
// A second address is a second object with its own document: no code path
// reaches across, so one board's notes, colours and positions can never be
// read from another.
//
// Nothing here counts participants: the simultaneous-editor capacity
// (MAX_CONCURRENT_EDITORS) is a design and test target, never a limit, so a
// 6th person on a board is accepted like anyone else (live.over_capacity).
import { isValidBoardId } from '../shared/board-id';
import { STATUS_INVALID_BOARD_ID, STATUS_UPGRADE_REQUIRED } from '../shared/protocol';
import { ROOM_PATH_PREFIX } from '../shared/routes';
import { BoardRoom } from './board-room';

export interface Env {
  /** One BoardRoom per board address. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client (static assets), served for every non-API path. */
  ASSETS: Fetcher;
}

/** 426 Upgrade Required: the address is a board, but this is not a WebSocket. */
const UPGRADE_REQUIRED = STATUS_UPGRADE_REQUIRED;

/** 400 Bad Request: the address is not a well-formed board id. */
const INVALID_BOARD_ID = STATUS_INVALID_BOARD_ID;

const INVALID_BOARD_ID_BODY = 'Not a valid board id\n';
const UPGRADE_REQUIRED_BODY = 'Expected a WebSocket upgrade\n';

function isUpgradeToWebsocket(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').trim().toLowerCase() === 'websocket';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith(ROOM_PATH_PREFIX)) {
      // The id is validated before the namespace is touched, so a malformed
      // address can never create a Durable Object instance.
      const boardId = pathname.slice(ROOM_PATH_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return new Response(INVALID_BOARD_ID_BODY, { status: INVALID_BOARD_ID });
      }
      if (!isUpgradeToWebsocket(request)) {
        return new Response(UPGRADE_REQUIRED_BODY, { status: UPGRADE_REQUIRED });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    // Everything else is the client: the board page, the root, an unknown
    // path. A malformed board id in a *page* address is left to the client,
    // which replaces it with a fresh one instead of failing the page.
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
