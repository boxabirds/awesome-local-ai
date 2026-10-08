/**
 * Test-only storage damage hooks (story 4, TC-24).
 *
 * These let the e2e suite deterministically damage and repair a board's
 * compacted snapshot so a real browser can observe the room's honest load
 * failure (close 4500 -> client `load_failed`) and its recovery without a
 * page reload. They are registered by the worker ONLY when
 * `env.TEST_HOOKS === '1'` (set in the e2e wrangler environment, never in
 * production config), so the production build has no hook routes — a
 * request to a hook path there falls through to the SPA (404/index.html).
 *
 * The helpers here are pure storage manipulation (they take the room's
 * BoardStore); the room (board-room.ts) orchestrates them together with the
 * KV backup and the real `reload()` load path.
 */

import * as Y from 'yjs';
import { chunkBytes } from '../shared/storage-chunks';
import type { BoardStore } from './board-store';

export type TestHookAction = 'corrupt-snapshot' | 'repair' | 'seed-legacy';

/** Matches `/__test/boards/<id>/(corrupt-snapshot|repair|seed-legacy)`. */
const HOOK_PATH = /^\/__test\/boards\/[^/]+\/(corrupt-snapshot|repair|seed-legacy)$/;

export function parseTestHookAction(pathname: string): TestHookAction | null {
  const m = HOOK_PATH.exec(pathname);
  return m === null ? null : (m[1] as TestHookAction);
}

/** Durable Object KV key that holds the original chunk 0 (hex-encoded). */
export const TEST_HOOK_BACKUP_KEY = '__test_backup_chunk_0';

function toBytes(value: unknown): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : (value as Uint8Array);
}

/** Hex-encode a byte array (DO KV stores text; a raw Uint8Array is lossy). */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/** The inverse of toHex. */
export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Ensures the board has a compacted snapshot and returns its chunk 0, or
 * null for an empty board. A small board (e.g. the 25-note TC-24 fixture)
 * never crosses a natural compaction threshold, so when no snapshot exists
 * this forces one: snapshot the current storage state, then truncate the log
 * into it — the same swap compactIfNeeded performs, unconditionally.
 */
export function ensureSnapshotChunk0(store: BoardStore): Uint8Array | null {
  const sql = store.storage.sql;
  const existing = sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray();
  if (existing.length > 0) {
    return toBytes(existing[0]['data']);
  }
  // No snapshot yet: rebuild one from the current storage (snapshot + log).
  const doc = new Y.Doc();
  const result = store.load(doc);
  if (!result.ok) {
    throw new Error('ensureSnapshotChunk0: load failed: ' + result.reason);
  }
  const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
  if (chunks.length === 0) {
    return null; // empty board: nothing to snapshot (or corrupt)
  }
  const maxRow = sql.exec('SELECT MAX(seq) AS m FROM updates').toArray()[0];
  const maxSeq = maxRow === null || maxRow.m === null ? 0 : Number(maxRow.m);
  store.storage.transactionSync(() => {
    sql.exec('DELETE FROM snapshot_chunks').toArray();
    chunks.forEach((data, idx) => {
      sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, data).toArray();
    });
    sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq).toArray();
    sql
      .exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        'snapshot_through_seq',
        String(maxSeq),
      )
      .toArray();
  });
  return chunks[0];
}

/** Overwrites chunk 0 of the compacted snapshot with `bytes`. */
export function overwriteChunk0(store: BoardStore, bytes: Uint8Array): void {
  store.storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', bytes).toArray();
}
