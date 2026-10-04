/**
 * Worker entry: the whole HTTP surface of vidi6.
 *
 *   /api/boards           POST: a new board, at a new unguessable link
 *   /api/boards/:boardId  GET: is this board one of ours? (200 / 404)
 *   /api/rooms/:boardId   WebSocket upgrade for one board -> its BoardRoom
 *   /__test/boards/:id/…  test-only board surgery, routed only when TEST_HOOKS=1
 *   everything else       the client bundle (static assets, SPA fallback)
 *
 * `idFromName(boardId)` gives every board its own Durable Object holding its own
 * `Y.Doc`, which is what keeps boards separate (live.isolation): a change on one
 * board is applied and broadcast inside one object and never leaves it.
 *
 * Nothing here counts participants: MAX_CONCURRENT_EDITORS is a soft design and
 * test target, so a 6th person on a board is accepted like anyone else
 * (live.over_capacity).
 *
 * Story 5 (share.board_api) adds the two board routes above, and one rule that
 * covers every one of them: an address that is not a board of ours is answered here
 * without naming a Durable Object, because naming one wakes it up and an object
 * woken by a guess must not have been woken — let alone left with tables, a board,
 * and a place in the list of things that exist. `POST /api/boards` is what makes a
 * board exist, and only that.
 */

import { isValidBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
import { BoardRoom } from './board-room';
import { TEST_HOOK_PREFIX } from './test-hooks';
import { handleServe, handleUpload } from './assets';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  /**
   * '1' in the test servers, unset in a production deploy. Only then are the
   * `/__test/boards/:id/...` routes forwarded to a room; without it those paths are
   * ordinary unknown paths and fall through to the SPA.
   */
  TEST_HOOKS?: string;
}

/**
 * Path prefix of the realtime endpoint; the next segment is the board id.
 * Not exported: every export of a Worker entry module must be the default
 * handler or a Durable Object class.
 */
const ROOM_PATH_PREFIX = '/api/rooms/';

/** Prefix of the board routes; the next segment, if any, is a board id. */
const BOARDS_PATH_PREFIX = '/api/boards';

/** Prefix of the asset serving route. */
const ASSETS_PATH_PREFIX = '/api/assets/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (env.TEST_HOOKS === '1' && pathname.startsWith(TEST_HOOK_PREFIX)) {
      const boardId = pathname.slice(TEST_HOOK_PREFIX.length).split('/')[0] ?? '';
      if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return room.fetch(request);
    }

    if (pathname.startsWith(BOARDS_PATH_PREFIX)) {
      return boards(request, env, pathname);
    }

    if (pathname.startsWith(ASSETS_PATH_PREFIX)) {
      const key = pathname.slice(ASSETS_PATH_PREFIX.length);
      return handleServe(env, key);
    }

    if (!pathname.startsWith(ROOM_PATH_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    const boardId = pathname.slice(ROOM_PATH_PREFIX.length);
    if (!isValidBoardId(boardId)) {
      // 404, where story 3 answered 400 (share.not_found). A malformed address is not
      // a board of ours, and that is the whole answer: replying "invalid id" would
      // tell whoever is walking the namespace which guesses are well formed, and the
      // one thing an address must not do is explain itself to a stranger.
      return jsonResponse(404, { error: 'not_found' });
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }

    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return room.fetch(request);
  },
};

/**
 * `/api/boards` and `/api/boards/:id` — creation, and the existence question the
 * client asks before it shows a board (share.not_found).
 *
 * Two things are deliberately true here: a malformed id never reaches the
 * namespace (so it cannot instantiate anything), and a well formed id reaching a
 * stranger's object is a single read (`exists`) that writes nothing.
 *
 * Everything under `/api/boards` is answered here, including the shapes that are not
 * one of these two routes: a path that starts like our API and is not in it should
 * say so, rather than quietly serve the web page.
 */
async function boards(request: Request, env: Env, pathname: string): Promise<Response> {
  const rest = pathname.slice(BOARDS_PATH_PREFIX.length);
  if (rest !== '' && !rest.startsWith('/')) return jsonResponse(404, { error: 'not_found' });

  if (rest === '') {
    if (request.method === 'POST') {
      const created = await createBoard(env);
      // 500 with `create_failed`: no board, and no link to be sorry about.
      return created.ok
        ? jsonResponse(201, { id: created.id })
        : jsonResponse(500, { error: created.reason });
    }
    return methodNotAllowed('POST');
  }

  // Everything under the collection is one board's address, possibly with a sub-path
  // like `/assets`. The board id is the first segment after `/api/boards/`.
  const afterPrefix = pathname.slice(`${BOARDS_PATH_PREFIX}/`.length);
  const boardId = decodeURIComponent(afterPrefix.split('/')[0] ?? '');
  if (!isValidBoardId(boardId)) return jsonResponse(404, { error: 'not_found' });

  // POST /api/boards/:boardId/assets — upload an image to the board
  const subPath = afterPrefix.slice(boardId.length);
  if (subPath === '/assets') {
    if (request.method === 'POST') {
      return handleUpload(request, env, boardId);
    }
    return methodNotAllowed('POST');
  }
  if (subPath !== '') return jsonResponse(404, { error: 'not_found' });

  switch (request.method) {
    case 'GET':
    case 'HEAD':
      // The id comes back in the body so the answer can be checked against the
      // question — a client that was redirected, or served something stale, sees a
      // different id and knows not to trust it.
      return (await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists())
        ? jsonResponse(200, { id: boardId })
        : jsonResponse(404, { error: 'not_found' });
    default:
      // Including DELETE: no API can remove a board (board.close), so a shared link
      // is only ever broken by being mistyped, and never by an unlucky call.
      return methodNotAllowed('GET, HEAD');
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Boards are created and read. Nothing else is defined, now or by omission. */
function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow },
  });
}

export { BoardRoom };
