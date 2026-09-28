/**
 * Story 4: BoardStore — SQLite-backed persistence for a board's Y.Doc.
 *
 * One database per board (one Durable Object per board). The store owns the
 * schema, the append path (write-before-broadcast), the load path (snapshot +
 * log replay with quarantine of damaged rows) and chunked compaction.
 *
 * - `append` rethrows SQL errors so the room can reset (persist.save_failure).
 * - `load` converts a damaged snapshot to `snapshot-unreadable`, a SQL error to
 *   `sql-error`, and quarantines (never deletes) individual damaged log rows.
 * - `compactIfNeeded` snapshots the doc into chunked rows inside a single
 *   `transactionSync`; any error rolls back (snapshot and log stay intact).
 *
 * The SQL API is synchronous, so a row is durably inserted in the same turn it
 * is applied; the platform's output gates hold any broadcast until that write
 * is confirmed (persist.seen_is_saved).
 */
import * as Y from 'yjs';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  STORAGE_SCHEMA_VERSION,
} from 'src/shared/config';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Origin marker for updates applied while loading (never stored/broadcast). */
export const LOAD_ORIGIN = Symbol('board-store-load-origin');

/** Splits `data` into at-most-`size` chunks. Zero-length input → zero chunks. */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, i + size));
  }
  return chunks;
}

/** Concatenates chunks back into a single byte array (byte-identical). */
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

/** Compaction threshold: by row count or by cumulative log bytes. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';
const META_LOAD_STATUS = 'load_status';
const META_LAST_LOAD_ATTEMPT = 'last_load_attempt_at';
/** Test-only: when set, the next `load`'s SELECT throws (sql-error path). */
const META_ARM_SELECT_FAIL = 'arm_select_fail';

export class BoardStore {
  private updateCount = 0;
  private updateBytes = 0;
  private appendFailNext = false;

  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql(): DurableObjectStorage['sql'] {
    return this.storage.sql;
  }

  /** Creates tables (if absent) and records the schema version. No rows. */
  migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshot_chunks (
        idx INTEGER PRIMARY KEY,
        data BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quarantined_updates (
        seq INTEGER PRIMARY KEY,
        data BLOB NOT NULL,
        error TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      );
    `);
    this.sql.exec(
      'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** Records the schema version for a loaded store (used by tests). */
  schemaVersion(): number {
    const rows = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_SCHEMA_VERSION)
      .toArray();
    return rows.length > 0 ? Number(rows[0].value) : 0;
  }

  /**
   * Appends one Yjs update to the log. Rethrows on SQL failure (the caller
   * resets the room). Tracks in-memory row count / byte total.
   */
  append(update: Uint8Array): void {
    if (this.appendFailNext) {
      this.appendFailNext = false;
      throw new Error('injected append failure');
    }
    this.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      update,
      update.byteLength,
    );
    this.updateCount += 1;
    this.updateBytes += update.byteLength;
  }

  /** Test-only: make the next append throw once (persist.save_failure path). */
  armAppendFailure(): void {
    this.appendFailNext = true;
  }

  /**
   * Test-only: arm a one-shot SELECT failure so the next `load` reports
   * `sql-error` (persist.load_failure sql-error path). The flag is persisted in
   * storage_meta so it survives hibernation/reconstruct (the load runs in the
   * constructor of the next instance).
   */
  armSelectFailure(): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
      META_ARM_SELECT_FAIL,
      '1',
    );
  }

  /** Number of log rows currently held in memory (post-load/append/compact). */
  logCount(): number {
    return this.updateCount;
  }

  private snapshotThroughSeq(): number {
    const rows = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_SNAPSHOT_THROUGH)
      .toArray();
    return rows.length > 0 ? Number(rows[0].value) : 0;
  }

  /**
   * Loads the persisted board into `doc`.
   *
   * 1. Snapshot chunks (ordered) are concatenated and applied; an apply error
   *    → `snapshot-unreadable` with nothing deleted or quarantined.
   * 2. Log rows with seq > snapshot_through_seq are applied in order; a row
   *    Yjs rejects is moved to `quarantined_updates` and counted.
   * 3. Any SQL error → `sql-error`.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const armed = this.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', META_ARM_SELECT_FAIL)
        .toArray();
      if (armed.length > 0) {
        this.sql.exec('DELETE FROM storage_meta WHERE key = ?', META_ARM_SELECT_FAIL);
        throw new Error('injected select failure');
      }
      const chunkRows = this.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray();
      if (chunkRows.length > 0) {
        const bytes = joinChunks(
          chunkRows.map((r) => new Uint8Array(r.data as ArrayBuffer)),
        );
        try {
          Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
        } catch (e) {
          console.error(
            JSON.stringify({ event: 'board.load.snapshot_unreadable', error: String(e) }),
          );
          return { ok: false, reason: 'snapshot-unreadable', error: String(e) };
        }
      }

      const through = this.snapshotThroughSeq();
      const updateRows = this.sql
        .exec('SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();

      let quarantined = 0;
      let count = 0;
      let bytes = 0;
      for (const row of updateRows) {
        const data = new Uint8Array(row.data as ArrayBuffer);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          count += 1;
          bytes += data.byteLength;
        } catch (e) {
          this.quarantine(Number(row.seq), data, e);
          quarantined += 1;
        }
      }
      this.updateCount = count;
      this.updateBytes = bytes;
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: String(e) };
    }
  }

  private quarantine(seq: number, data: Uint8Array, error: unknown): void {
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        String(error),
        Date.now(),
      );
    });
    console.error(
      JSON.stringify({ event: 'board.load.quarantined', seq, error: String(error) }),
    );
  }

  /**
   * Compacts when the log exceeds a threshold. Snapshots the doc (which already
   * contains snapshot + log) into chunked rows, deletes the now-covered log
   * rows and advances snapshot_through_seq — all in one transactionSync.
   * Returns true when a compaction happened; false for a no-op or a rolled-back
   * failure. Never throws.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.updateCount, this.updateBytes)) return false;
    return this.compactNow(doc);
  }

  /**
   * Unconditional compaction: snapshot the doc and truncate the log regardless
   * of the size thresholds. Used by the `force-compact` test op so a small
   * board (e.g. 25 notes) can be compacted to test the snapshot-corruption
   * path.
   */
  forceCompact(doc: Y.Doc): boolean {
    return this.compactNow(doc);
  }

  private compactNow(doc: Y.Doc): boolean {
    try {
      const maxSeq = Number(
        this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates').one().m,
      );
      const snapshot = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(snapshot);
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((c, i) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, c);
        });
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          META_SNAPSHOT_THROUGH,
          String(maxSeq),
        );
      });
      this.updateCount = 0;
      this.updateBytes = 0;
      return true;
    } catch (e) {
      console.error(
        JSON.stringify({ event: 'board.compaction.failed', error: String(e) }),
      );
      return false;
    }
  }

  // --- Load-failure retry bookkeeping (persist.load_failure) ---

  /** Last recorded load attempt: whether it failed and when (ms). */
  loadStatus(): { failed: boolean; lastAttemptAt: number } {
    const status = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_LOAD_STATUS)
      .toArray();
    const attempt = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_LAST_LOAD_ATTEMPT)
      .toArray();
    return {
      failed: status.length > 0 && status[0].value === 'failed',
      lastAttemptAt: attempt.length > 0 ? Number(attempt[0].value) : 0,
    };
  }

  /** Records a load attempt (time + ok/failure) so the retry interval is honored. */
  recordLoadAttempt(at: number, ok: boolean): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
      META_LOAD_STATUS,
      ok ? 'ok' : 'failed',
    );
    this.sql.exec(
      'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
      META_LAST_LOAD_ATTEMPT,
      String(at),
    );
  }
}
