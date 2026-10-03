// Test-only HTTP hooks for the e2e "broken board" story (TC-24), so a test can
// corrupt a board's stored snapshot and later repair it over real HTTP.
//
// These routes exist ONLY when `env.TEST_HOOKS === '1'`, which is set only on the
// `wrangler dev` command line in the e2e harness — never in `wrangler.jsonc`, so a
// production deploy has no such route and a request to `/__test/...` falls through
// to the SPA (this is what TC-24's "production build lacks the hook routes"
// assertion checks). The surgery itself runs inside the board's Durable Object, so
// it acts on that board's own storage and in-memory state.

/** The minimal shape of a board-room namespace we need to reach one board's DO. */
interface RoomNamespace {
  idFromName(id: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

const TEST_HOOK_PREFIX = '/__test/boards/';

/**
 * Handle a `/__test/boards/:id/:action` request by forwarding it to that board's
 * Durable Object as `/__test/:action`. Returns `null` when hooks are not enabled or
 * the path is not a test route, so the caller falls through to normal routing.
 */
export async function handleTestHook(
  request: Request,
  env: { BOARD_ROOM: RoomNamespace; TEST_HOOKS?: string },
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(TEST_HOOK_PREFIX)) return null;

  const rest = url.pathname.slice(TEST_HOOK_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    return new Response('test hook path is /__test/boards/:id/:action', { status: 400 });
  }
  const boardId = rest.slice(0, slash);
  const action = rest.slice(slash + 1);

  // Forward into the DO; the DO re-checks TEST_HOOKS before acting.
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const forwarded = new Request(url.origin + '/__test/' + action, {
    method: request.method,
  });
  return stub.fetch(forwarded);
}
