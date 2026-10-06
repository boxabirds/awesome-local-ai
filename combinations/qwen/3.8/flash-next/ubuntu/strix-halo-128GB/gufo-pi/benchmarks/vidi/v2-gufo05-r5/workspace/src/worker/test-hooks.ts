/**
 * The test-only storage hooks: two routes that make a board's stored snapshot unreadable, and put
 * it back.
 *
 * `POST /__test/boards/:boardId/corrupt-snapshot` and `POST /__test/boards/:boardId/repair`.
 *
 * They exist because the honest way to test "this board could not be read" is to make it
 * unreadable, and because reaching into Durable Object storage from a test process would tie the
 * suite to how local storage happens to be laid out - file names, table names, the lot - none of
 * which is ours to depend on. So the Worker, which does own those bytes, offers the two
 * operations, and the end-to-end test calls them over HTTP like anybody else.
 *
 * Both are switched off unless `TEST_HOOKS === '1'`, which only the e2e dev servers pass and no
 * production config does. With the switch off nothing routes these paths at all: they are not
 * `/api/...`, so they fall through to the assets, and a request gets the SPA's `index.html` back -
 * which is what TC-24 asks to be verified about a production build.
 */
import type { BoardRoom } from './board-room';

/** What a hook call does to the board's storage. */
export type StorageHookAction = 'corrupt-snapshot' | 'repair';

/** The bindings a hook needs: the board's room, which is the only thing that can reach its rows. */
export interface StorageHookBindings {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
}

/** Whether this deployment answers the hooks. Off unless the environment says otherwise. */
export function testHooksEnabled(env: { TEST_HOOKS?: string }): boolean {
  return env.TEST_HOOKS === '1';
}

/** The public path prefix, and the action that follows it: `/__test/boards/<id>/<action>`. */
const HOOK_PREFIX = '/__test/boards/';
const HOOK_ACTIONS: readonly StorageHookAction[] = ['corrupt-snapshot', 'repair'];

/** The board and action a public hook request addresses, or `null` for any other path. */
export function parseStorageHook(pathname: string): { boardId: string; action: StorageHookAction } | null {
  if (!pathname.startsWith(HOOK_PREFIX)) return null;
  const rest = pathname.slice(HOOK_PREFIX.length);
  const slash = rest.lastIndexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  const action = HOOK_ACTIONS.find((candidate) => candidate === rest.slice(slash + 1));
  if (action === undefined) return null;
  return { boardId: decodeURIComponent(rest.slice(0, slash)), action };
}

/** The room's own address for a hook: a request only the Worker sends, and only when enabled. */
const HOOK_ROOM_PATH = '/__test/storage';

/**
 * Hands a hook to the board's room. The room answers with what it did, or `409` when the board has
 * nothing of the kind to work on - a board that was never compacted has no snapshot to corrupt.
 */
export async function deliverStorageHook(
  bindings: StorageHookBindings,
  boardId: string,
  action: StorageHookAction,
): Promise<Response> {
  const stub = bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
  return stub.fetch(new Request(`https://board-room${HOOK_ROOM_PATH}?action=${action}`, {
    method: 'POST',
  }));
}

/** The hook this internal request asks the room to run, or `null` when it is an ordinary request. */
export function storageHookOf(request: Request): StorageHookAction | null {
  const url = new URL(request.url);
  if (url.pathname !== HOOK_ROOM_PATH) return null;
  const action = url.searchParams.get('action');
  return HOOK_ACTIONS.find((candidate) => candidate === action) ?? null;
}

