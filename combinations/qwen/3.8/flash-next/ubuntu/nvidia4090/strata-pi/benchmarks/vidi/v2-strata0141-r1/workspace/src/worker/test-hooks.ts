/**
 * Test-only storage hooks (anchor `persist.client_status`, task "E2E broken
 * board").
 *
 * A browser test cannot damage a board's stored bytes, and it should not have to
 * wait five hundred edits for a snapshot to exist. These routes let a test do
 * exactly the two things the "broken board" workflow needs, plus a read of the
 * storage counters it is asserting against:
 *
 * ```text
 * POST /__test/boards/:id/corrupt-snapshot   damage snapshot chunk 0
 * POST /__test/boards/:id/repair             put the original bytes back
 * GET  /__test/boards/:id/stats              row counts and byte totals
 * ```
 *
 * **They exist only when `env.TEST_HOOKS === '1'`.** That value is set on the
 * `wrangler dev` command line the e2e run starts, and nowhere else: it is not in
 * `wrangler.jsonc`, so a production Worker has no branch here at all and a
 * request to one of these addresses falls through to the client build. An
 * integration test asserts that.
 *
 * Nothing here reaches a board a person is using: the routes only call the
 * room's own `test*` methods, and those only touch the board named in the
 * address.
 */

import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

/** Every hook lives under this prefix, and nothing else is handled here. */
export const TEST_HOOK_PREFIX = '/__test/';

export const testHooksEnabled = (env: Env): boolean => env.TEST_HOOKS === '1';

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Handle a test hook request, or return `null` when this request is not one -
 * which includes every request in a build where the hooks are not enabled.
 */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (!path.startsWith(TEST_HOOK_PREFIX)) {
    return null;
  }
  if (!testHooksEnabled(env)) {
    // Not a test build: pretend the route does not exist, so the request lands
    // on the client build exactly as it would in production.
    return null;
  }

  const parts = path.slice(TEST_HOOK_PREFIX.length).split('/');
  const [kind, boardId, action] = parts;
  if (kind !== 'boards' || boardId === undefined || action === undefined || parts.length !== 3) {
    return json({ ok: false, reason: 'unknown test hook' }, 404);
  }
  if (!isValidBoardId(boardId)) {
    return json({ ok: false, reason: 'invalid board id' }, 400);
  }

  const namespace = env.BOARD_ROOM;
  const room = namespace.get(namespace.idFromName(boardId));

  if (action === 'stats' && req.method === 'GET') {
    return json({ ok: true, stats: await room.testStats() });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, reason: 'test hooks are POST' }, 405);
  }

  if (action === 'corrupt-snapshot') {
    const result = await room.testCorruptSnapshot();
    return json(result, result.ok ? 200 : 409);
  }
  if (action === 'repair') {
    const result = await room.testRepairSnapshot();
    return json(result, result.ok ? 200 : 409);
  }
  if (action === 'compact') {
    // Force the log into a snapshot, so a test can be in the Snapshotted state
    // without anyone typing five hundred notes.
    return json({ ok: true, compacted: await room.testCompactNow() });
  }

  return json({ ok: false, reason: 'unknown test hook' }, 404);
}
