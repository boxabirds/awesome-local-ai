/**
 * Types and a client for the room's test-only HTTP routes
 * (`/__test/boards/:id/...`), shared by the live integration tests and the
 * end-to-end tests, which point at different servers.
 *
 * The shapes here mirror `StorageSummary` and `LoadResult` from
 * `src/worker/board-store.ts`. They are spelled out again rather than imported:
 * that module is written against the Workers runtime's globals, and a Node
 * program cannot even look at it. `tests/types/worker-shapes.ts` checks at compile
 * time that the two still match, so they cannot drift apart unnoticed.
 */

import type { StickySnapshot } from '../../src/shared/board-model';
import type { RoomState } from '../../src/worker/room-state';

export interface StorageSummary {
  schemaVersion: number | null;
  updateCount: number;
  updateBytes: number;
  snapshotChunks: number;
  snapshotThroughSeq: number;
  quarantined: number;
}

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export interface BoardStatus {
  board: string;
  state: RoomState;
  /** When a read of this board last failed, as storage recorded it, or null. */
  loadFailedAt: number | null;
  lastLoadError: string;
  sockets: number;
  retryDue: boolean;
  storage: StorageSummary;
}

export interface StoredBoard {
  state: RoomState;
  load: LoadResult;
  notes: readonly StickySnapshot[];
  storage: StorageSummary;
}

export interface BoardHooks {
  status(boardId: string): Promise<BoardStatus>;
  storedBoard(boardId: string): Promise<StoredBoard>;
  storedNotes(boardId: string): Promise<readonly StickySnapshot[]>;
  reload(boardId: string): Promise<{ state: RoomState; load: LoadResult }>;
  compact(boardId: string): Promise<{ compacted: boolean; storage: StorageSummary }>;
  corruptSnapshot(boardId: string): Promise<{ corrupted: true; chunk: number; bytes: number }>;
  repairSnapshot(boardId: string): Promise<{ repaired: true; bytes: number }>;
  failAppend(boardId: string, times?: number): Promise<{ armed: number }>;
  failLoad(boardId: string, times?: number): Promise<{ armed: number }>;
  seed(
    boardId: string,
    kind: 'retro' | 'large',
    notes?: number,
  ): Promise<{ seeded: string; notes: number; compacted: boolean; storage: StorageSummary }>;
  abort(boardId: string): Promise<void>;
}

/**
 * Every hook is plain JSON over HTTP. `fetchImpl` lets a Playwright test send the
 * request through its own request context (so it follows the test's baseURL); the
 * Node tests use the global `fetch`.
 */
export function boardHooks(httpBaseUrl: string, fetchImpl: typeof fetch = fetch): BoardHooks {
  async function call<T>(boardId: string, action: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${httpBaseUrl}/__test/boards/${boardId}/${action}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(`test hook ${action} failed (${response.status}): ${body.error ?? 'no reason given'}`);
    }
    return body;
  }

  async function abort(boardId: string): Promise<void> {
    // The object is torn down in the middle of the request, so a failed request is
    // the expected outcome; anything else is worth seeing.
    await fetchImpl(`${httpBaseUrl}/__test/boards/${boardId}/abort`, { method: 'POST' }).catch(() => undefined);
  }

  return {
    status: (boardId) => call<BoardStatus>(boardId, 'status'),
    storedBoard: (boardId) => call(boardId, 'board'),
    storedNotes: async (boardId) => (await call<StoredBoard>(boardId, 'board')).notes,
    reload: (boardId) => call(boardId, 'reload', { method: 'POST' }),
    compact: (boardId) => call(boardId, 'compact', { method: 'POST' }),
    corruptSnapshot: (boardId) => call(boardId, 'corrupt-snapshot', { method: 'POST' }),
    repairSnapshot: (boardId) => call(boardId, 'repair', { method: 'POST' }),
    failAppend: (boardId, times = 1) => call(boardId, 'fail-append', { method: 'POST', body: JSON.stringify({ times }) }),
    failLoad: (boardId, times = 1) => call(boardId, 'fail-load', { method: 'POST', body: JSON.stringify({ times }) }),
    seed: (boardId, kind, notes) => call(boardId, 'seed', { method: 'POST', body: JSON.stringify({ kind, notes }) }),
    abort,
  };
}
