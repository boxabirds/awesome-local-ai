/**
 * Story 3 · the room Worker (design §3–§7).
 *
 * The Worker is the single entrypoint that Cloudflare runs. It does two things:
 *
 *   1. validates that an incoming request is a *collab* connection — a
 *      WebSocket upgrade whose path is `/api/rooms/<boardId>` for a well-formed
 *      board id — and rejects anything else (`426`), so a stray `/api/...` or a
 *      non-upgrade never reaches a room;
 *   2. hands an accepted connection to the board's `BoardRoom` Durable Object,
 *      which is the single writer that relays sync/awareness frames between the
 *      sockets on that room.
 *
 * Everything that is not a room upgrade is served from static assets (the
 * single-page app), so a browser navigation to `/b/<id>` still gets the app.
 *
 * There is no authentication and no durable storage beyond the in-memory room
 * document — exactly the Story 3 scope.
 */
import { BoardRoom } from './board-room';
import { isTestPath, ROOM_PATH_PREFIX, parseRoomRequest } from './routing';
import { parseTestHook, testHooksEnabled } from './test-hooks';

// Re-exported so the Workers runtime can resolve the `durable_objects`
// `class_name: "BoardRoom"` binding against this module's exports. The rule
// this file follows: only the default handler and DO classes are exported — a
// plain value export here is read as a service entrypoint and stops workerd
// from booting (see `routing.ts`).
export { BoardRoom };

/**
 * The Durable Object namespace binding. Declared as an optional, loosely-typed
 * field so the same file typechecks for the browser test build (where it is
 * absent) and for the Workers runtime (where it is injected).
 */
interface Env {
  BOARD_ROOM?: DurableObjectNamespace<BoardRoom>;
  ASSETS?: Fetcher;
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
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
      const forwarded = new Request(`https://room${url.pathname}`, {
        method: 'POST',
      });
      return stub.fetch(forwarded);
    }

    // A WebSocket upgrade on a valid room path is a collab connection: forward
    // it to that board's Durable Object, which accepts the socket and relays.
    if (isUpgrade && room.ok) {
      const namespace = env.BOARD_ROOM;
      if (namespace === undefined) {
        // No DO binding (e.g. a plain `vite build` test): nothing to upgrade to.
        return new Response('Upgrade Required', { status: 426 });
      }
      const id = namespace.idFromName(room.boardId);
      const stub = namespace.get(id);
      return stub.fetch(request);
    }

    // A room path that is *not* a valid collab upgrade (a plain GET, a bad id)
    // is a client error: it is explicitly not served from assets.
    if (url.pathname.startsWith(ROOM_PATH_PREFIX)) {
      return new Response('Upgrade Required', { status: 426 });
    }

    // Everything else is the single-page app: hand it to static assets.
    if (env.ASSETS !== undefined) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  },
};
