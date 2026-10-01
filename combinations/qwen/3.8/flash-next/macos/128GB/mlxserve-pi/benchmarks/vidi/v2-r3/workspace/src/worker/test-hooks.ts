// Test-only HTTP hooks for story 4's broken-board end-to-end test (TC-24).
//
// A browser test cannot wait for a real disk to fail, so it breaks and mends a
// saved board through these routes instead: corrupt a board's snapshot so its
// room goes to load-failed, then repair it so the same room loads again without
// a page reload.
//
// These routes exist only when `env.TEST_HOOKS === '1'`, which the e2e wrangler
// environment sets and the production config never does. `src/worker/index.ts`
// checks the flag before ever calling into this module; an integration test
// verifies that, with the flag absent as it is in production, a request to a hook
// path never returns the hook's response and never looks a board up.
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

/**
 * Every hook hangs off this prefix; the segment after it is the board id.
 *
 * It lives under `/api/` on purpose: the static-asset config only sends
 * `/api/*` to the Worker first (`run_worker_first`), and everything else is
 * answered by the SPA fallback before the Worker is ever consulted. A path
 * outside `/api/` would be served `index.html` and never reach the hook. Under
 * `/api/` the Worker sees it, and the `TEST_HOOKS` flag still decides whether
 * the hook does anything — in production it falls through to the SPA, inert.
 */
export const TEST_HOOK_PATH_PREFIX = '/api/__test/boards/';

/** What each recognised action does to a board's room, as a stub method. The
 * return is awaited: over Durable Object RPC a synchronous method comes back as
 * a promise, but the class type declares it synchronous, so the result is typed
 * loosely and narrowed by the await. */
const ACTIONS: Record<string, (room: BoardRoom) => unknown> = {
  'corrupt-snapshot': (room) => room.testCorruptSnapshot(),
  repair: (room) => room.testRepairSnapshot(),
};

/**
 * Handle a `/__test/boards/:id/:action` request. Returns a Response only for a
 * path under the hook prefix; `null` means "not ours, carry on routing" (so a
 * stray `/__test/...` still falls through to the client rather than 404-ing in
 * a way that would confuse a real request).
 */
export async function handleTestHook(
  request: Request,
  env: { BOARD_ROOM: DurableObjectNamespace<BoardRoom> },
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(TEST_HOOK_PATH_PREFIX)) return null;

  if (request.method !== 'POST') {
    return json({ error: 'use POST' }, 405);
  }

  const [boardId, action, ...rest] = pathname.slice(TEST_HOOK_PATH_PREFIX.length).split('/');
  if (boardId === undefined || action === undefined || rest.length > 0) {
    return json({ error: 'expected /api/__test/boards/:id/(corrupt-snapshot|repair)' }, 400);
  }
  if (!isValidBoardId(boardId)) {
    return json({ error: 'not a valid board id' }, 400);
  }
  const run = ACTIONS[action];
  if (run === undefined) {
    return json({ error: `unknown action ${action}` }, 404);
  }

  // `get(idFromName(...))` may wake a room that is asleep; the hook then reads
  // its own storage. This never creates board content — it only opens the object.
  // A Durable Object stub answers a class method as a remote call (it returns a
  // promise); the stub's declared type omits the methods, so it is narrowed here
  // to the class to make the remote call, exactly as the platform dispatches it.
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)) as unknown as BoardRoom;
  try {
    const done = (await run(stub)) as boolean;
    return json({ ok: done }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
