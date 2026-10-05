/**
 * Test-only surgery on a board, so a browser test can damage one.
 *
 * Story 4's TC-24 has to show a person what a board that cannot be opened looks like.
 * Damaging it from the test side is not possible: the board lives inside a Durable
 * Object's SQLite, which only that object can reach, and the persistence e2e specs run
 * against a real `wrangler dev`, where the test-side `cloudflare:test` helpers do not
 * exist. So the Worker offers two routes, and they exist only when the runtime was
 * started for tests.
 *
 * **How they are kept out of production.** `TEST_HOOKS` is not set anywhere in
 * `wrangler.jsonc`; the e2e web server passes `--var TEST_HOOKS:1` on its command line,
 * and that command line is part of the Playwright config, not of the deployed app. With
 * the variable absent, `handleTestHookRequest` never runs, `/__test/...` falls through
 * to the assets and comes back as the SPA (`spec 004 task 9 verifies exactly this`).
 * The Durable Object checks the variable again on its side, so a request that reaches
 * it directly is refused just the same.
 *
 * What the hooks do is deliberately narrow: damage the snapshot and put it back. They
 * cannot create a board, read one, or reach another board — the id in the path is
 * validated before it selects an object, exactly as the WebSocket route validates it.
 */

import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

/** Everything under this prefix is a test hook. */
export const TEST_HOOK_PREFIX = '/__test/';

/** The environment variable that turns the hooks on. */
export const TEST_HOOKS_ENV_VAR = 'TEST_HOOKS';

/** Is this runtime running the end-to-end tests? */
export function testHooksEnabled(env: { [TEST_HOOKS_ENV_VAR]?: string }): boolean {
  return env[TEST_HOOKS_ENV_VAR] === '1';
}

/** The two operations, and they are the only two. */
export type TestHookAction = 'corrupt-snapshot' | 'repair';

export interface TestHookTarget {
  boardId: string;
  action: TestHookAction;
}

/** `POST /__test/boards/<boardId>/corrupt-snapshot`, or nothing at all. */
export function parseTestHook(pathname: string): TestHookTarget | null {
  if (!pathname.startsWith(TEST_HOOK_PREFIX)) return null;
  const parts = pathname.slice(TEST_HOOK_PREFIX.length).split('/');
  if (parts.length !== 3 || parts[0] !== 'boards') return null;
  const requested: unknown = parts[2];
  if (requested !== 'corrupt-snapshot' && requested !== 'repair') return null;
  if (!isValidBoardId(parts[1])) return null;
  return { boardId: parts[1], action: requested };
}

/** The path a room is asked to act on, with nothing else attached to it. */
export function testHookRequest(action: TestHookAction): Request {
  return new Request(`https://test-hooks.local${TEST_HOOK_PREFIX}${action}`, { method: 'POST' });
}

/** Hand the request to that board's own room, which is the only thing that can reach
 * its storage. */
export async function handleTestHookRequest(request: Request, env: Env): Promise<Response> {
  if (!testHooksEnabled(env)) return new Response('Not found', { status: 404 });
  const target = parseTestHook(new URL(request.url).pathname);
  if (target === null) return new Response('No such test hook', { status: 404 });
  if (request.method !== 'POST') return new Response('Test hooks are POST only', { status: 405 });

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(target.boardId));
  return stub.fetch(testHookRequest(target.action));
}
