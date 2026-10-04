/**
 * The test-hooks client for the live integration project: the same routes as
 * `tests/fixtures/hooks.ts`, pointed at the `wrangler dev` instance this project
 * starts (see `live-server.ts`).
 */

import { boardHooks } from '../../fixtures/hooks';
import { LIVE_HTTP_URL } from './ws-client';

export const hooks = boardHooks(LIVE_HTTP_URL);
export type { BoardHooks, BoardStatus, LoadResult, StorageSummary, StoredBoard } from '../../fixtures/hooks';

/**
 * Story 5: make this address a board.
 *
 * A test used to be able to join any id it invented; now a board exists only if
 * somebody created it, and a test has no button to press. This calls the same
 * `initialize()` that `POST /api/boards` calls, so the board that turns up is built
 * the normal way — only its address comes from the test, which is the one thing the
 * API deliberately does not offer (a person is never allowed to claim an address).
 *
 * A test that *probes* an address it expects to be empty must not call this: the empty
 * address is the thing it is testing.
 */
export async function ensureBoard(boardId: string): Promise<void> {
  await hooks.initialize(boardId);
}
