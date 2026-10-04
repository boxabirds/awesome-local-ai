/**
 * A compile-time check that the shapes duplicated in `tests/fixtures/hooks.ts`
 * still match the ones the worker sends.
 *
 * The hooks are plain JSON over HTTP, so nothing at runtime can notice the two
 * sides drifting apart — a renamed field would just read as `undefined` in a test
 * and a test would pass for the wrong reason. Assignability in both directions is
 * the guard: `npm run typecheck` stops when either side changes.
 *
 * This file is part of the worker program (`tsconfig.worker.json`) because
 * `src/worker/board-store.ts` is written against the Workers runtime's globals,
 * which the client program does not have.
 */

import type { LoadResult as WorkerLoadResult, StorageSummary as WorkerStorageSummary } from '../../src/worker/board-store';
import type { LoadResult as HookLoadResult, StorageSummary as HookStorageSummary } from '../fixtures/hooks';

declare const workerSummary: WorkerStorageSummary;
declare const hookSummary: HookStorageSummary;
declare const workerLoad: WorkerLoadResult;
declare const hookLoad: HookLoadResult;

export const summaryAsHook: HookStorageSummary = workerSummary;
export const summaryAsWorker: WorkerStorageSummary = hookSummary;
export const loadAsHook: HookLoadResult = workerLoad;
export const loadAsWorker: WorkerLoadResult = hookLoad;
