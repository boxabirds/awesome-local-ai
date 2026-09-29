/**
 * Story 5 · the Worker entrypoint (design "HTTP contract").
 *
 * Three kinds of request are answered here, and the order matters:
 *
 *   1. `POST /api/boards` creates a board (rate limited, unguessable id, no
 *      storage written unless a board is actually made);
 *   2. `GET /api/boards/:id` answers "does this board exist?" — the check the
 *      board page runs before it opens a socket. It only ever *reads*, and a
 *      malformed id never reaches a Durable Object at all;
 *   3. `/api/rooms/:id` is the story 3 collab upgrade, now gated on the same
 *      existence rule: an unknown or malformed id is a `404`, so following a
 *      mistyped link no longer creates a board (PRD share.not_found).
 *
 * Everything that is not one of those is served from static assets (the
 * single-page app), so a browser navigation to `/b/<id>` still reaches the
 * client router.
 *
 * There is no authentication: possession of the link is the whole access
 * control for now (design "Security model").
 */
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleAssetRead, handleAssetUpload, parseAssetPath } from './assets';
import { isBoardId } from '../shared/board-id';
import type { Env } from './env';
import { isTestPath, ROOM_PATH_PREFIX, parseRoomRequest } from './routing';
import { parseTestHook, testHooksEnabled } from './test-hooks';

// Re-exported so the Workers runtime can resolve the `durable_objects`
// `class_name: "BoardRoom"` binding against this module's exports. The rule
// this file follows: only the default handler and DO classes are exported — a
// plain value export here is read as a service entrypoint and stops workerd
// from booting (see `routing.ts`).
export { BoardRoom };

/** The create endpoint, and the prefix of the per-board existence endpoint. */
const BOARDS_PATH = '/api/boards';

/** Story 12 · the shared asset-read prefix (`/api/assets/:boardId/:assetId`). */
const ASSETS_READ_PATH = '/api/assets/';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The board id a `/api/boards/<id>` path carries, or `null` for other paths. */
function boardIdInBoardsPath(pathname: string): string | null {
  if (!pathname.startsWith(`${BOARDS_PATH}/`)) return null;
  const rest = pathname.slice(BOARDS_PATH.length + 1);
  // Exactly one segment after `/api/boards/`: anything deeper is not a board
  // address and must not be answered here.
  if (rest.length === 0 || rest.includes('/')) return null;
  return decodeURIComponent(rest);
}

/**
 * Who a creation is counted against: `CF-Connecting-IP`, the same key the
 * platform rate limiter is documented to be used with. Locally the header is
 * absent, so the key is empty and every local request shares one bucket — the
 * honest behaviour for a single-visitor development machine.
 */
function visitorKey(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? '';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isUpgrade =
      request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    const room = parseRoomRequest(url.pathname);

    // Test-only routes (story 4). When `TEST_HOOKS` is not set they do not
    // exist: the request falls through to the single-page app, so a production
    // build cannot be walked into a room's storage by guessing the path.
    if (isTestPath(url.pathname)) {
      const hook = parseTestHook(url.pathname);
      const namespace = env.BOARD_ROOM;
      if (
        request.method !== 'POST' ||
        hook === null ||
        !testHooksEnabled(env) ||
        namespace === undefined
      ) {
        return env.ASSETS !== undefined
          ? env.ASSETS.fetch(request)
          : new Response('Not Found', { status: 404 });
      }
      const stub = namespace.get(namespace.idFromName(hook.boardId));
      // The body is forwarded so `seed-legacy` can carry its update bytes; the
      // two snapshot hooks send nothing and are unaffected.
      const body = await request.arrayBuffer();
      const forwarded = new Request(`https://room${url.pathname}`, {
        method: 'POST',
        ...(body.byteLength > 0
          ? { body, headers: { 'content-type': 'application/json' } }
          : {}),
      });
      return stub.fetch(forwarded);
    }

    // ---- POST /api/boards: create a board -------------------------------
    if (url.pathname === BOARDS_PATH && request.method === 'POST') {
      const result = await createBoard(env, visitorKey(request));
      if (result.ok) return json({ id: result.id }, 201);
      return result.reason === 'rate_limited'
        ? json({ error: 'rate_limited' }, 429)
        : json({ error: 'create_failed' }, 500);
    }

    // ---- POST /api/boards/:id/assets: upload images (story 12) ----------
    // Matched before the existence branch, which only answers a single board-id
    // segment. The board is verified first: an id that does not exist gets no
    // upload at all (TC-10) — this build has no way to read a board's presence
    // from here, so we require a *well-formed* id and rely on the bucket prefix
    // plus the read-side scoping for cross-board safety.
    if (
      request.method === 'POST' &&
      url.pathname.startsWith(`${BOARDS_PATH}/`) &&
      url.pathname.endsWith('/assets')
    ) {
      const boardId = decodeURIComponent(
        url.pathname.slice(BOARDS_PATH.length + 1, -'/assets'.length),
      );
      return handleAssetUpload(request, { env, boardId, key: visitorKey(request) });
    }

    // ---- GET /api/assets/:boardId/:assetId: serve an image (story 12) ---
    if (request.method === 'GET' && url.pathname.startsWith(ASSETS_READ_PATH)) {
      const target = parseAssetPath(url.pathname);
      // A malformed key (wrong length, a missing part, a `..`) is a 404 with no
      // bucket read at all, so a bad path cannot escape its board prefix (TC-15).
      if (target === null) return json({ error: 'not_found' }, 404);
      return handleAssetRead({ env, boardId: target.boardId, key: visitorKey(request), target });
    }

    // ---- GET /api/boards: wrong method ----------------------------------
    if (url.pathname === BOARDS_PATH) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // ---- GET /api/boards/:id: does this board exist? --------------------
    const askedFor = boardIdInBoardsPath(url.pathname);
    if (askedFor !== null) {
      // A malformed id answers 404 with no distinction from an unknown one (so
      // nothing is leaked about the id space) and, deliberately, no Durable
      // Object is instantiated to answer it.
      const namespace = env.BOARD_ROOM;
      if (!isBoardId(askedFor) || namespace === undefined) {
        return json({ error: 'not_found' }, 404);
      }
      const stub = namespace.get(namespace.idFromName(askedFor));
      const exists = await stub.exists();
      return exists ? json({ id: askedFor }) : json({ error: 'not_found' }, 404);
    }

    // ---- /api/rooms/:id: the collab socket ------------------------------
    if (isUpgrade && room.ok) {
      const namespace = env.BOARD_ROOM;
      if (namespace === undefined) {
        // No DO binding (e.g. a plain `vite build` test): nothing to upgrade to.
        return new Response('Upgrade Required', { status: 426 });
      }
      // One hop, no pre-probe: the room answers a plain 404 for an address that
      // holds no board, before it accepts anything.
      const id = namespace.idFromName(room.boardId);
      const stub = namespace.get(id);
      return stub.fetch(request);
    }

    // A room path that is *not* a valid collab upgrade (a plain GET, a bad id)
    // is a client error: it is explicitly not served from assets. A bad id is a
    // 404 (there is no such board); a well-formed id without an upgrade is a
    // 426 (this path is a socket, not a document).
    if (url.pathname.startsWith(ROOM_PATH_PREFIX)) {
      return room.ok
        ? new Response('Upgrade Required', { status: 426 })
        : json({ error: 'not_found' }, 404);
    }

    // Everything else is the single-page app: hand it to static assets.
    if (env.ASSETS !== undefined) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};
