// Test-only HTTP hooks over the BoardRoom's storage (Task 4).
//
// These let a test put a board into a state no amount of clicking could
// produce — a damaged snapshot, an injected SQL failure, a pre-compacted log —
// and read the storage back without mocks. They exist ONLY while the dev
// server runs with `--var TEST_HOOKS:1` (npm run test:integration); a
// production build has no such route (tests/e2e/production-hooks.spec.ts).

import { HTTP_ORIGIN } from './server';

/** What `GET /__test/rooms/:id/state` answers (see src/worker/test-hooks.ts). */
export interface RoomState {
  state: string;
  serving: boolean;
  hibernating: boolean;
  loadAttempts: number;
  retryInMs: number;
  chunkCount: number;
  snapshotBytes: number;
  log: Array<{ seq: number; bytes: number }>;
  snapshot: Array<{ idx: number; bytes: number }>;
  quarantined: Array<{ seq: number; error: string }>;
  storeStats: { logCount: number; logBytes: number; snapshotThroughSeq: number } | null;
}

/** Poll `check` until it is true, or fail after `timeoutMs`. */
/** Poll until `check` holds; resolves true, or false after the timeout. */
export async function until(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export class RoomHooks {
  constructor(private readonly origin: string = HTTP_ORIGIN) {}

  private path(boardId: string, hook: string): string {
    return `${this.origin}/__test/rooms/${boardId}/${hook}`;
  }

  /** Current lifecycle + storage bookkeeping of one board. */
  async state(boardId: string): Promise<RoomState> {
    const response = await fetch(this.path(boardId, 'state'));
    if (!response.ok) throw new Error(`state hook answered ${response.status}`);
    return (await response.json()) as RoomState;
  }

  /** Load raw Yjs update bytes as fixture state (not stored, not broadcast). */
  async seed(boardId: string, update: Uint8Array): Promise<RoomState> {
    const response = await fetch(this.path(boardId, 'seed'), {
      method: 'POST',
      body: new Uint8Array(update),
    });
    const body = (await response.json()) as RoomState & { ok: boolean };
    if (!body.ok) throw new Error(`seed hook answered ${response.status}`);
    return body;
  }

  /* Journal counters, or null when the room has no live store right now
   * (load-failed / storage-failed). Lets a test write `toBe(1)` / `toBeNull()`
   * instead of unwrapping `storeStats` at every call site. */
  async logCount(boardId: string): Promise<number | null> {
    return (await this.state(boardId)).storeStats?.logCount ?? null;
  }

  async logBytes(boardId: string): Promise<number | null> {
    return (await this.state(boardId)).storeStats?.logBytes ?? null;
  }

  /** Run one real compaction rewrite (log → snapshot chunks). */
  async compact(boardId: string): Promise<RoomState> {
    const response = await fetch(this.path(boardId, 'compact'), { method: 'POST' });
    const body = (await response.json()) as RoomState & { ok: boolean };
    if (!body.ok) throw new Error(`compact hook answered ${response.status}`);
    return body;
  }

  /** Make the next `reads`/`writes` SQL calls throw (`select` matches SQL text). */
  async injectFailure(
    boardId: string,
    opts: { reads?: number; writes?: number; select?: string },
  ): Promise<void> {
    const response = await fetch(this.path(boardId, 'inject-failure'), {
      method: 'POST',
      body: JSON.stringify(opts),
    });
    if (!response.ok) throw new Error(`inject-failure hook answered ${response.status}`);
  }

  /** Damage snapshot chunk 0 (same length, garbage content). */
  async corruptSnapshot(boardId: string, chunk = 0): Promise<void> {
    const response = await fetch(this.path(boardId, 'corrupt-snapshot'), {
      method: 'POST',
      body: JSON.stringify({ chunk }),
    });
    if (!response.ok) throw new Error(`corrupt-snapshot hook answered ${response.status}`);
  }

  /** Restore chunk 0 and reload the document (recovery without a new object). */
  async repair(boardId: string): Promise<void> {
    const response = await fetch(this.path(boardId, 'repair'), { method: 'POST' });
    if (!response.ok) throw new Error(`repair hook answered ${response.status}`);
  }

  /** Raw access for assertions that need the exact status code. */
  raw(boardId: string, hook: string): Promise<Response> {
    return fetch(this.path(boardId, hook));
  }

  /** Convenience: the highest stored log seq (0 when the log is empty). */
  lastSeq(state: RoomState): number {
    return state.log.reduce((highest, row) => Math.max(highest, row.seq), 0);
  }
}

export const hooks = new RoomHooks();
