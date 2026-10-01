import * as Y from 'yjs';
import type { DurableObjectStorage, SqlValue } from 'cloudflare:workers';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * The result of loading a board from storage.
 * - `ok: true` with a `quarantined` count: the doc was populated; `quarantined` log rows
 *   were damaged and moved to `quarantined_updates` (persist.partial_damage).
 * - `ok: false` with a reason: the board could not be loaded and must not be presented as
 *   empty (persist.load_failure).
 */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' };

/** Origin tag for updates applied while loading (neither stored nor broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

/**
 * Split `data` into chunks of at most `size` bytes. A 0-length input yields 0 chunks.
 * Pure and side-effect free (persist.board_store chunking maths, TC-01).
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) throw new Error('chunkBytes: size must be positive');
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.slice(i, i + size));
  }
  return chunks;
}

/** Concatenate chunks back into a single byte array. Inverse of `chunkBytes` (TC-01). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Whether the update log has grown large enough to warrant compaction.
 * Compacts at exactly the threshold (TC-02).
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  // Some runtimes surface blobs as typed-array-like objects with a buffer
  const v = value as { buffer?: ArrayBuffer; byteOffset?: number; byteLength?: number };
  if (v && v.buffer instanceof ArrayBuffer) {
    return new Uint8Array(v.buffer, v.byteOffset ?? 0, v.byteLength ?? v.buffer.byteLength);
  }
  throw new Error('board-store: expected a blob value');
}

/**
 * Persists every Yjs update for one board to Durable Object SQLite storage.
 *
 * One database per board. The document is reconstructed on wake as:
 *   snapshot_chunks (concatenated) + updates with seq > snapshot_through_seq.
 *
 * - `append` writes a row and rethrows SQL failures (the caller resets the room).
 * - `load` populates a doc; damaged log rows are quarantined and counted; an unreadable
 *   snapshot or a SQL error yields `ok: false` (nothing is deleted).
 * - `compactIfNeeded` snapshots the doc and truncates the log inside one transaction;
 *   on error it rolls back and returns false (never throws).
 *
 * SQL access uses the newer workerd `SqlStorage.exec(sql, ...params)` API, which returns a
 * one-shot `Cursor` (`toArray()` / `one()` / `rowsWritten`).
 */
export class BoardStore {
  storage: DurableObjectStorage;
  /** In-memory tracking of the current update log (rows not yet in the snapshot). */
  private updateCount = 0;
  private updateBytes = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  /**
   * Read-only existence check. Returns true if the board has been initialized
   * (storage_meta.created_at exists) or has legacy data (any updates or
   * snapshot_chunks rows). Queries sqlite_master first; never creates tables.
   */
  existsReadOnly(): boolean {
    try {
      // Check if storage_meta table exists and has created_at
      const tables = this.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='storage_meta'"
      ).toArray();
      if (tables.length > 0) {
        const rows = this.storage.sql.exec(
          "SELECT value FROM storage_meta WHERE key='created_at'"
        ).toArray();
        if (rows.length > 0) return true;
      }

      // Legacy: check if updates table exists and has rows
      const updatesTables = this.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='updates'"
      ).toArray();
      if (updatesTables.length > 0) {
        const countRow = this.storage.sql.exec('SELECT COUNT(*) as c FROM updates').one() as { c: number };
        if (countRow.c > 0) return true;
      }

      // Legacy: check if snapshot_chunks table exists and has rows
      const snapshotTables = this.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='snapshot_chunks'"
      ).toArray();
      if (snapshotTables.length > 0) {
        const countRow = this.storage.sql.exec('SELECT COUNT(*) as c FROM snapshot_chunks').one() as { c: number };
        if (countRow.c > 0) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /** All rows of a query as an array (empty if none). */
  private queryAll<T = unknown>(sql: string, ...params: SqlValue[]): T[] {
    return this.storage.sql.exec(sql, ...params).toArray() as T[];
  }

  /** The first row of a query, or null if none. */
  queryOne<T = unknown>(sql: string, ...params: SqlValue[]): T | null {
    const rows = this.queryAll<T>(sql, ...params);
    return rows.length > 0 ? rows[0] : null;
  }

  /** Create tables if absent and record the storage schema version. Writes no update rows. */
  migrate(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
    `);

    const existing = this.queryOne<{ value: string }>(
      'SELECT value FROM storage_meta WHERE key = ?',
      'storage_schema_version',
    );
    if (!existing) {
      this.storage.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        'storage_schema_version',
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /** Append one update to the log. Rethrows SQL failures (caller resets the room). */
  append(update: Uint8Array): void {
    // Lazily migrate if tables don't exist (legacy boards already have tables)
    if (!this.hasTables()) {
      this.migrate();
    }
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.updateCount += 1;
    this.updateBytes += update.length;
  }

  /** Check if the required tables exist without creating them. */
  private hasTables(): boolean {
    try {
      const tables = this.storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='updates'"
      ).toArray();
      return tables.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Load the board into `doc`. Applies the snapshot (if any) then the log rows after
   * `snapshot_through_seq`. Damaged log rows are quarantined and counted. Never deletes
   * data on failure. Treats missing tables as an empty board without creating them.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // If no tables exist, this is an empty board (no data to load)
      if (!this.hasTables()) {
        this.updateCount = 0;
        this.updateBytes = 0;
        return { ok: true, quarantined: 0 };
      }

      // 1. Snapshot
      const chunkRows = this.queryAll<{ data: unknown }>('SELECT data FROM snapshot_chunks ORDER BY idx');
      const chunks: Uint8Array[] = chunkRows.map((r) => toUint8Array(r.data));
      if (chunks.length > 0) {
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable' };
        }
      }

      // 2. Log rows after the snapshot
      const metaRow = this.queryOne<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        'snapshot_through_seq',
      );
      const throughSeq = metaRow ? parseInt(metaRow.value, 10) : 0;

      let quarantined = 0;
      const logRows = this.queryAll<{ seq: number; data: unknown }>(
        'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
        throughSeq,
      );
      for (const row of logRows) {
        const bytes = toUint8Array(row.data);
        try {
          Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
        } catch (e) {
          this.storage.transactionSync(() => {
            this.storage.sql.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq,
              bytes,
              String(e),
              Date.now(),
            );
            this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
          });
          quarantined += 1;
          console.error({ event: 'board-update-quarantined', seq: row.seq, error: String(e) });
        }
      }

      // Refresh in-memory counters from the remaining log.
      const counts = this.queryOne<{ count: number; bytes: number }>(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM updates',
      );
      this.updateCount = counts?.count ?? 0;
      this.updateBytes = counts?.bytes ?? 0;

      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'snapshot-unreadable' };
    }
  }

  /**
   * Compact the log into a chunked snapshot if it has grown past the thresholds.
   * Returns true if a compaction was performed, false for a no-op or a rolled-back
   * failure. Never throws.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.updateCount, this.updateBytes)) {
      return false;
    }

    try {
      const snapshotBytes = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(snapshotBytes);

      const maxSeqRow = this.queryOne<{ maxSeq: number }>(
        'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM updates',
      );
      const maxSeq = maxSeqRow?.maxSeq ?? 0;

      this.storage.transactionSync(() => {
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          this.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]);
        }
        this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        this.storage.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          String(maxSeq),
        );
      });

      this.updateCount = 0;
      this.updateBytes = 0;
      return true;
    } catch (e) {
      console.error({ event: 'board-compaction-failed', error: String(e) });
      return false;
    }
  }

  /** Test hook: corrupt the snapshot by overwriting chunk 0 with garbage. */
  corruptSnapshotForTesting(): void {
    const garbage = new Uint8Array(200);
    for (let i = 0; i < garbage.length; i++) garbage[i] = 0xFF;
    this.storage.sql.exec(
      'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?) ON CONFLICT(idx) DO UPDATE SET data = excluded.data',
      0,
      garbage,
    );
    // Ensure there's a snapshot_through_seq so load() tries to read the snapshot
    this.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'snapshot_through_seq',
      '0',
    );
  }

  /** Test hook: repair by writing a valid empty snapshot. */
  repairForTesting(): void {
    const empty = new Uint8Array(0);
    this.storage.sql.exec('DELETE FROM snapshot_chunks');
    this.storage.sql.exec(
      'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
      0,
      empty,
    );
    this.storage.sql.exec('DELETE FROM updates');
    this.storage.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'snapshot_through_seq',
      '0',
    );
  }
}
