import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

/**
 * Test-only worker routes (story 4, TC-24: the broken-board e2e).
 *
 * `POST /__test/boards/:boardId/corrupt-snapshot` overwrites snapshot chunk 0
 * with garbage (saving the original first) and `POST /__test/boards/:boardId/repair`
 * restores it. They exist so a real running worker can be pointed at a board
 * whose snapshot is unreadable, without restarting it with a special config.
 *
 * The routes are registered only when `env.TEST_HOOKS === '1'` (the `e2e`
 * wrangler env); in production the paths fall through to the static assets
 * (SPA fallback), so a request can never reach the Durable Object.
 *
 * Implementation note: this workerd build has no `runInDurableObject`, so the
 * worker forwards the call to the room's own `fetch` on a private hostname
 * (`vidi6-test.local`) that no public request can produce — the room then
 * dispatches the operation without touching a WebSocket.
 */

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair|hibernate|seed-legacy)$/;

/** Hostname of the forwarded internal requests (never seen on public paths). */
export const TEST_HOOK_HOST = 'vidi6-test.local';

/**
 * Handle a test-hook request, or return null when the request is not a hook
 * (caller falls through to normal routing) or the hooks are not enabled.
 */
export async function handleTestHook(
  req: Request,
  url: URL,
  env: Env,
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1' || req.method !== 'POST') return null;
  const match = url.pathname.match(HOOK_PATH);
  if (match === null) return null;
  const boardId = match[1]!;
  if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });
  const action = match[2]!;
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return stub.fetch(
    new Request(`http://${TEST_HOOK_HOST}/${action}`, { method: 'POST' }),
  );
}
