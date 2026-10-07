import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

/**
 * The test-only board routes, e.g.
 * `POST /__test/boards/:boardId/corrupt-snapshot`, `/repair-snapshot`,
 * `/board-summary` and `/seed-legacy`.
 *
 * They exist so a browser test can drive a real board into another state (damaged
 * storage, or the shape a board had *before* story 5 shipped) and back, through the
 * same code paths production uses. The whole route is registered only when
 * `env.TEST_HOOKS === '1'`, which only the e2e wrangler environment sets — never in
 * the production config, where these paths fall through to the SPA fallback.
 */
const TEST_HOOK_PATH =
  /^\/__(?:test|diag)\/boards\/([^/]+)\/(corrupt-snapshot|repair-snapshot|board-summary|seed-legacy)$/;

/** JSON body of `/seed-legacy`: real Yjs updates as base64, one per log row. */
interface SeedLegacyBody {
  updates: string[];
}

/**
 * Handle a test-hook request, or return null when hooks are off or the path is not
 * a hook. Registered before the asset fallthrough and gated on `TEST_HOOKS`.
 */
export async function routeTestHook(request: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const match = TEST_HOOK_PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const boardId = decodeURIComponent(match[1]!);
  if (!isValidBoardId(boardId)) return new Response('invalid board id', { status: 400 });
  const action = match[2];
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

  let result: unknown;
  if (action === 'corrupt-snapshot') result = await room.testCorruptSnapshot();
  else if (action === 'repair-snapshot') result = await room.testRepairSnapshot();
  else if (action === 'board-summary') result = await room.testBoardSummary();
  else {
    // seed-legacy: the caller supplies real update bytes (from `tests/fixtures/boards.ts`),
    // so the seeded board is byte-for-byte what a pre-story-5 board would hold.
    const body = (await request.json()) as SeedLegacyBody;
    if (!Array.isArray(body.updates)) {
      return new Response(JSON.stringify({ error: 'updates_required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    result = await room.testSeedLegacy(body.updates);
  }
  return new Response(JSON.stringify({ ok: true, action, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
