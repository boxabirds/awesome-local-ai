// Test-only storage hooks (design D10 / TC-24, and story 5's TC-31).
//
// TC-24 needs a board whose stored bytes are really damaged — not a mocked load —
// so the code that detects, reports and recovers from the damage is the production
// code. This module is the entire door to that: POST routes that ask a board to
// damage or repair its own snapshot.
//
// TC-31 needs a board that was saved BEFORE the create API existed: the
// `seed-legacy` action writes real update rows and no `created_at`, so that board
// is only recognised by the legacy half of the existence rule. `initialize`
// creates a board without spending one of the rate limiter's slots (the stories
// 1-4 e2E suites are not about creation limits).
//
// The door is closed unless `VIDI_TEST_HOOKS` is exactly '1'. That variable appears
// in no production config; the e2E harnesses pass it on the command line
// (`wrangler dev --var VIDI_TEST_HOOKS:1`). Everywhere else both routes answer 404,
// and the room refuses the action again on its own side, so a request that somehow
// reaches the object directly is still turned away.
//
// The storage actions themselves live on `BoardStore`, which owns the tables.

import { isValidBoardId } from '../shared/board-id.ts';

export const TEST_HOOK_PATH =
  /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair|initialize|seed-legacy)$/;

export type TestStorageAction = 'corrupt-snapshot' | 'repair' | 'initialize' | 'seed-legacy';

export interface TestHookEnv {
  VIDI_TEST_HOOKS?: string;
}

/** The hooks are enabled only in the harness environment. */
export function testHooksEnabled(env: TestHookEnv): boolean {
  return env.VIDI_TEST_HOOKS === '1';
}

/** Parse a pathname into a board id + action, or null when it is not a hook call. */
export function parseTestHook(
  pathname: string,
): { boardId: string; action: TestStorageAction } | null {
  const match = TEST_HOOK_PATH.exec(pathname);
  if (!match || !isValidBoardId(match[1])) return null;
  return { boardId: match[1], action: match[2] as TestStorageAction };
}

/** Indistinguishable from any other unknown route. */
export function testHookNotFound(): Response {
  return new Response('not found', { status: 404 });
}
