/**
 * Test-only routes, handled only when `env.TEST_HOOKS === '1'` (set by the e2e `wrangler dev`
 * command line, never in wrangler.jsonc). Otherwise these paths fall through to the static
 * assets like any unknown address.
 *
 *   POST /__test/boards/:id/compact           force compaction of the board's log
 *   POST /__test/boards/:id/corrupt-snapshot  save then damage snapshot chunk 0; room reloads
 *   POST /__test/boards/:id/repair            restore the saved chunk
 *   POST /__test/boards/:id/initialize        create the board at this id (no rate limit), story 5
 *   POST /__test/boards/:id/seed-legacy       body: a Yjs update, stored as a board from before
 *                                             story 5 (log row, no created_at)
 */
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

export const TEST_HOOKS_PREFIX = '/__test/boards/';
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const ACTIONS = ['compact', 'corrupt-snapshot', 'repair', 'initialize', 'seed-legacy'] as const;
type Action = (typeof ACTIONS)[number];

export function testHooksEnabled(env: Env): boolean {
  return env.TEST_HOOKS === '1';
}

/** Handles a test-hook request, or returns null when the request is not one. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (!testHooksEnabled(env) || req.method !== 'POST') return null;
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(TEST_HOOKS_PREFIX)) return null;
  const [boardId, action, ...rest] = pathname.slice(TEST_HOOKS_PREFIX.length).split('/');
  if (boardId === undefined || !isValidBoardId(boardId) || rest.length > 0) return null;
  if (!ACTIONS.includes(action as Action)) return new Response('Unknown hook', { status: HTTP_NOT_FOUND });
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  let result: unknown;
  switch (action as Action) {
    case 'compact':
      result = await room.testCompact();
      break;
    case 'corrupt-snapshot':
      result = await room.testCorruptSnapshot();
      break;
    case 'repair':
      await room.testRepairSnapshot();
      result = 'repaired';
      break;
    case 'initialize':
      result = await room.initialize();
      break;
    case 'seed-legacy':
      result = await room.testSeedLegacy(new Uint8Array(await req.arrayBuffer()));
      break;
  }
  return Response.json({ result }, { status: HTTP_OK });
}
