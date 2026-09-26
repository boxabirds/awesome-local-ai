import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '@/shared/config';

/**
 * Board storage (story 4, persist.board_store).
 *
 * One SQLite database per board (Durable Object storage):
 *
 *   storage_meta(key, value)        schema version + snapshot_through_seq
 *   updates(seq, data, bytes)       the append-only update log
 *   snapshot_chunks(idx, data)      the compacted snapshot, chunked rows
 *   quarantined_updates(...)        damaged log rows moved here on load
 *
 * `append` is write-before-broadcast: the room inserts the row in the same
 * turn the update was applied and only broadcasts after the insert, so a
 * change is durable before any other client can see it.
 *
 * `load` applies the snapshot then the log rows after it; a log row that
 * Yjs rejects is quarantined (the board stays usable minus that one change),
 * while an unreadable snapshot fails the whole load (LoadFailed).
 *
 * `compactIfNeeded` folds the log into a chunked snapshot inside one
 * transaction; a failure rolls the transaction back, leaving the previous
 * snapshot and log intact.
 *
 * The installed @cloudflare/workers-types exposes only `sql.exec(query,
 * ...bindings)` (no `prepare`), so all statements go through it. BLOBs are
 * bound as ArrayBuffer and read back as ArrayBuffer.
 */

/** Doc origin for updates applied while loading (never stored, never broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('board-store-load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Splits `data` into chunks of at most `size` bytes (0..n chunks). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    out.push(data.slice(i, i + size));
  }
  return out;
}

/** Concatenates chunks back into one byte array (inverse of chunkBytes). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Compaction threshold: at this many log rows or this many log bytes. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** Error text for structured logs / quarantine rows. */
function errMsg(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Copies a byte array into its own exact-length ArrayBuffer (SQL binding). */
function toBuffer(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer;
}

/** Coerces a BLOB read (ArrayBuffer or, defensively, Uint8Array). */
function asBytes(v: unknown): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer);
}

type MetaRow = { value: string };
type ChunkRow = { idx: number; data: ArrayBuffer };
type LogRow = { seq: number; data: ArrayBuffer; bytes: number };
type SeqRow = { m: number | null };

export class BoardStore {
  /** Log rows currently stored (re-synced on load; updated on append/compact). */
  private updateCount = 0;
  /** Total bytes of the stored log (same bookkeeping). */
  private updateBytes = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  /**
   * Creates the tables (idempotent) and records the storage schema version
   * if absent. Writes no update rows: a never-edited board that is merely
   * opened ends up with tables only (TC-25).
   */
  migrate(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (
        seq INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        error TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      );
    `);
    if (this.metaGet('storage_schema_version') === null) {
      this.metaSet('storage_schema_version', String(STORAGE_SCHEMA_VERSION));
    }
  }

  /**
   * Appends one update to the log. Rethrows SQL errors — the caller (the
   * room) resets itself on failure. Test hooks may arm a one-shot failure
   * flag (`test_fail_append`) which is consumed here, outside the SQL call.
   */
  append(update: Uint8Array): void {
    if (this.consumeFailureFlag('test_fail_append')) {
      throw new Error('injected append failure (test hook)');
    }
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toBuffer(update), update.length);
    this.updateCount += 1;
    this.updateBytes += update.length;
  }

  /**
   * Loads the persisted state into `doc`: snapshot first (if any), then the
   * log rows after `snapshot_through_seq`. A log row that fails to apply is
   * moved to quarantined_updates and counted; the rest of the board loads.
   * An unreadable snapshot (or a SQL error anywhere) fails the whole load
   * and deletes nothing.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Test hook: one-shot injected load failure (TC-26).
      if (this.consumeFailureFlag('test_fail_load_select')) {
        return { ok: false, reason: 'sql-error', error: 'injected load failure (test hook)' };
      }

      const through = this.snapshotThroughSeq();

      // 1. Snapshot (only recorded together with a positive through_seq).
      if (through > 0) {
        const rows = this.storage.sql
          .exec<ChunkRow>('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
          .toArray();
        if (rows.length === 0) {
          // Metadata says a snapshot exists but no chunk rows do: unreadable.
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: 'snapshot metadata without chunk rows',
          };
        }
        const bytes = joinChunks(rows.map((r) => asBytes(r.data)));
        try {
          Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
        } catch (err) {
          // Snapshot damage is fatal (persist.load_failure): the room must
          // not serve an empty doc. Nothing is deleted or quarantined.
          return { ok: false, reason: 'snapshot-unreadable', error: errMsg(err) };
        }
      }

      // 2. Log rows after the snapshot, in seq order.
      const rows = (
        through > 0
          ? this.storage.sql.exec<LogRow>('SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq', through)
          : this.storage.sql.exec<LogRow>('SELECT seq, data, bytes FROM updates ORDER BY seq')
      ).toArray();

      let quarantined = 0;
      let remaining = 0;
      let remainingBytes = 0;
      for (const row of rows) {
        const data = asBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (err) {
          // One damaged change does not lose the board (persist.partial_damage):
          // move the row to quarantine and keep going.
          this.storage.transactionSync(() => {
            this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
            this.storage.sql.exec(
              'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq,
              toBuffer(data),
              errMsg(err),
              Date.now(),
            );
          });
          quarantined += 1;
          console.error({
            event: 'board-update-quarantined',
            seq: row.seq,
            error: errMsg(err),
          });
          continue;
        }
        remaining += 1;
        remainingBytes += row.bytes;
      }

      // Re-sync the in-memory counters with the durable state.
      this.updateCount = remaining;
      this.updateBytes = remainingBytes;
      return { ok: true, quarantined };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: errMsg(err) };
    }
  }

  /**
   * Compacts the log into a chunked snapshot when the thresholds are
   * reached. The chunk delete, chunk insert, log truncation and through_seq
   * update run in ONE transaction: any failure rolls back, leaving the
   * previous snapshot and log intact. Never throws; false on no-op or
   * rolled-back failure.
   *
   * `force` (test hooks only) bypasses the threshold check.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.updateCount, this.updateBytes)) return false;
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(snapshot);
      const through = this.snapshotThroughSeq();
      const mRow = this.storage.sql.exec<SeqRow>('SELECT MAX(seq) AS m FROM updates').toArray();
      const maxSeq = mRow[0]?.m ?? through;

      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        // Test hook: one-shot injected failure AFTER the chunk delete, so the
        // real rollback is exercised (TC-11).
        if (this.consumeFailureFlag('test_fail_compaction_after_chunk_delete')) {
          throw new Error('injected compaction failure (test hook)');
        }
        for (let i = 0; i < chunks.length; i++) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, toBuffer(chunks[i]));
        }
        if (maxSeq > 0) {
          sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        }
        this.metaSet('snapshot_through_seq', String(maxSeq));
      });

      this.updateCount = 0;
      this.updateBytes = 0;
      return true;
    } catch (err) {
      // Rolled back: the previous snapshot and the log are intact.
      console.error({ event: 'board-compaction-failed', error: errMsg(err) });
      return false;
    }
  }

  // --- storage_meta helpers -----------------------------------------------

  metaGet(key: string): string | null {
    const rows = this.storage.sql.exec<MetaRow>('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
    return rows[0]?.value ?? null;
  }

  private metaSet(key: string, value: string): void {
    this.storage.sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', key, value);
  }

  /** The seq up to which the snapshot covers the log (0 when absent). */
  private snapshotThroughSeq(): number {
    const raw = this.metaGet('snapshot_through_seq');
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /**
   * Consumes a one-shot test-failure flag from storage_meta (set by the
   * test-only hooks; never set in production). Returns true exactly once.
   */
  private consumeFailureFlag(key: string): boolean {
    const rows = this.storage.sql.exec<MetaRow>('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
    if (rows.length === 0 || rows[0].value !== '1') return false;
    this.storage.sql.exec('DELETE FROM storage_meta WHERE key = ?', key);
    return true;
  }
}
