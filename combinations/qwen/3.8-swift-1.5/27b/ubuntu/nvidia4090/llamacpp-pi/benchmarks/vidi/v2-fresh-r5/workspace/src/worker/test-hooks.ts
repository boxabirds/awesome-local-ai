/**
 * Test-only HTTP hooks, enabled only when env.TEST_HOOKS === '1' (set in
 * test wrangler environments, never in production config).
 *
 *   POST /__test/boards/:boardId/corrupt-snapshot
 *     Corrupts the board's snapshot chunk 0 in place (backing it up) and
 *     invalidates the room's in-memory doc, so the next connection fails to
 *     load the board (room → "load-failed" → close 4500).
 *
 *   POST /__test/boards/:boardId/repair
 *     Restores the backed-up chunk and invalidates the doc, so the next
 *     connection loads the board successfully again.
 *
 * The hooks forward to the room's fetch with a `__test` query parameter;
 * the room performs the storage work (it owns the Durable Object storage).
 */
import type { Env } from './index';

export async function handleTestHooks(req: Request, env: Env, url: URL): Promise<Response> {
  const match = url.pathname.match(/^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair)$/);
  if (req.method !== 'POST' || !match) {
    return new Response('Not Found', { status: 404 });
  }
  const [, boardId, action] = match;
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const target = new URL(req.url);
  target.pathname = `/api/rooms/${boardId}`;
  target.search = `__test=${action}`;
  return stub.fetch(new Request(target, { method: 'POST' }));
}
