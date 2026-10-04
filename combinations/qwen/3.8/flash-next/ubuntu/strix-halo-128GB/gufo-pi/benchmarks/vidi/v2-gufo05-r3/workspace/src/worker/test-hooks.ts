/**
 * Server-side test hooks for the persistence story (task 10).
 *
 * Reaching the states that storage failures live in from a browser is the hard
 * part: a corrupted snapshot, a compaction of a board nobody has time to click
 * 2000 notes into. These routes let a test put one board into those states
 * through the real path — they write to the board's real storage through the
 * board's own Durable Object, and never touch the browser.
 *
 * They exist only when `TEST_HOOKS=1` is set in the worker environment, which
 * the e2e dev server does and the production configuration does not; with the
 * flag unset the paths are ordinary unmatched routes and fall through to the SPA.
 */

import { isValidBoardId } from '../shared/board-id';

export const TEST_HOOK_PREFIX = '/__test/boards/';

export type TestHookName = 'corrupt-snapshot' | 'repair' | 'seed' | 'compact';

const HOOKS: TestHookName[] = ['corrupt-snapshot', 'repair', 'seed', 'compact'];

export interface TestHookRequest {
  boardId: string;
  hook: TestHookName;
}

export interface TestHookEnv {
  TEST_HOOKS?: string;
}

/** Are the hooks enabled in this deployment? (`TEST_HOOKS=1`) */
export function testHooksEnabled(env: TestHookEnv): boolean {
  return env.TEST_HOOKS === '1';
}

/**
 * The board and hook a path asks for, or `null` when this is an ordinary request.
 * The board id must be a real one, so a malformed path cannot reach the router.
 */
export function parseTestHook(pathname: string): TestHookRequest | null {
  if (!pathname.startsWith(TEST_HOOK_PREFIX)) return null;
  const rest = pathname.slice(TEST_HOOK_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const boardId = rest.slice(0, slash);
  const hook = rest.slice(slash + 1) as TestHookName;
  if (!isValidBoardId(boardId)) return null;
  return HOOKS.includes(hook) ? { boardId, hook } : null;
}
