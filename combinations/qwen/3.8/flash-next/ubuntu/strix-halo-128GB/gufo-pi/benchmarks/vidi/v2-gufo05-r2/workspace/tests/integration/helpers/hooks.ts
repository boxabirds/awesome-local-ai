/**
 * The test-hooks client for the live integration project: the same routes as
 * `tests/fixtures/hooks.ts`, pointed at the `wrangler dev` instance this project
 * starts (see `live-server.ts`).
 */

import { boardHooks } from '../../fixtures/hooks';
import { LIVE_HTTP_URL } from './ws-client';

export const hooks = boardHooks(LIVE_HTTP_URL);
export type { BoardHooks, BoardStatus, LoadResult, StorageSummary, StoredBoard } from '../../fixtures/hooks';
