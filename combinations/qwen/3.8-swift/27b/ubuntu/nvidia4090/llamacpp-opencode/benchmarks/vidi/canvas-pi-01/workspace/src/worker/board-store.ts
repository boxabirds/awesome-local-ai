// Board persistence store (see spec: persist.board_store).
//
// One SQLite database per board (Durable Object storage). The store owns the
// schema and every read/write:
//   storage_meta        (key, value)                -- storage_schema_version,
//                                                       snapshot_through_seq
//   updates             (seq, data, bytes)          -- append-only update log
//   snapshot_chunks     (idx, data)                 -- chunked snapshot
//   quarantined_updates (seq, data, error, at)      -- damaged log rows
//
// Guarantees (spec):
// - migrate() writes no update rows (TC-25);
// - append() rethrows SQL errors so the room can reset (persist.save_failure);
// - load() converts a damaged snapshot to ok:false (persist.load_failure) and
//   quarantines damaged log rows without touching anything else
//   (persist.partial_damage);
// - compactIfNeeded() never throws: a failed transaction rolls back and the
//   previous snapshot + log stay intact (TC-11).
//
// The storage parameter is declared structurally (not as
// `cloudflare:workers`' DurableObjectStorage) so this module also typechecks
// under the node-pool unit tests, where that module's types are unavailable.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Result of loading a board document from storage. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Origin tag for updates applied while loading (never stored, never broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

// ---- storage shape (structural; see file header) ----

export interface BoardSqlCursor {
  /** All rows as objects keyed by column name (empty array when no rows). */
  toArray(): Array<Record<string, unknown>>;
}

export interface BoardSql {
  /** Execute a statement with positional `?` bindings. */
  exec(query: string, ...bindings: (string | number | boolean | null | Uint8Array | ArrayBuffer)[]): BoardSqlCursor;
}

export interface BoardStorage {
  sql: BoardSql;
  /** Synchronous transaction: commits when the closure returns, rolls back on throw. */
  transactionSync<T>(closure: () => T): T;
}

// ---- pure helpers (unit-tested, TC-01 / TC-02) ----

/** Split `data` into chunks of at most `size` bytes (default SNAPSHOT_CHUNK_BYTES). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.slice(i, i + size));
  }
  return chunks;
}

/** Inverse of chunkBytes: concatenate chunks into one byte array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when the update log has reached a compaction threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

// ---- the store ----

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_THROUGH_SEQ = 'snapshot_through_seq';

export class BoardStore {
  /** Public (mutable) so tests can wrap the SQL surface to inject failures. */
  storage: BoardStorage;
  private rowCount = 0;
  private byteTotal = 0;

  constructor(storage: BoardStorage) {
    this.storage = storage;
  }

  /**
   * Create the tables (if absent) and record the storage schema version.
   * Writes no update rows: opening a never-edited board creates only tables
   * (TC-25).
   */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');
    const existing = sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_SCHEMA_VERSION)
      .toArray();
    if (existing.length === 0) {
      sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        META_SCHEMA_VERSION,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
    this.refreshCounters();
  }

  /**
   * Append one update to the log. Rethrows SQL errors: the caller (the room)
   * resets itself and closes all sockets with CLOSE_STORAGE_FAILURE.
   */
  append(update: Uint8Array): void {
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.rowCount += 1;
    this.byteTotal += update.length;
  }

  /**
   * Load the persisted board into `doc`: snapshot first, then every log row
   * with seq > snapshot_through_seq. A damaged log row is moved to
   * quarantined_updates (persist.partial_damage); a damaged snapshot or a SQL
   * error yields ok:false with nothing deleted (persist.load_failure).
   *
   * Caveat: Yjs applyUpdate is not atomic — a damaged row may partially
   * apply before it throws, so quarantining is best-effort for rows whose
   * damage survives the update header. Rows that fail at the header (e.g.
   * same-length random bytes) fail cleanly.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const through = this.metaValue(META_THROUGH_SEQ);
      const base = through === null ? 0 : Number(through);

      const chunkRows = this.storage.sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray();
      if (chunkRows.length > 0) {
        const snapshot = joinChunks(chunkRows.map((row) => new Uint8Array(row.data as ArrayBuffer)));
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (err) {
          console.error({ event: 'board-snapshot-unreadable', error: String(err) });
          return { ok: false, reason: 'snapshot-unreadable', error: String(err) };
        }
      }

      let quarantined = 0;
      const rows = this.storage.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', base)
        .toArray();
      for (const row of rows) {
        const update = new Uint8Array(row.data as ArrayBuffer);
        try {
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
        } catch (err) {
          this.quarantine(row.seq as number, update, String(err));
          quarantined += 1;
        }
      }
      if (quarantined > 0) this.refreshCounters();
      return { ok: true, quarantined };
    } catch (err) {
      console.error({ event: 'board-load-sql-error', error: String(err) });
      return { ok: false, reason: 'sql-error', error: String(err) };
    }
  }

  /** True when the log has reached a compaction threshold. */
  needsCompaction(): boolean {
    return shouldCompact(this.rowCount, this.byteTotal);
  }

  /**
   * Compact the log into a chunked snapshot when a threshold is reached.
   * Never throws: on SQL failure the transaction rolls back (previous
   * snapshot and log intact) and the counters are refreshed. Returns true
   * only when a compaction committed.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.needsCompaction()) return false;
    return this.compact(doc);
  }

  /** Test-only (spec task 6): force a compaction regardless of thresholds. */
  compactForTests(doc: Y.Doc): boolean {
    return this.compact(doc);
  }

  /** Test-only (spec task 9): save snapshot chunk 0 aside, then damage it. */
  corruptSnapshotForTests(): boolean {
    const rows = this.storage.sql
      .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
      .toArray();
    if (rows.length === 0) return false;
    const original = new Uint8Array(rows[0]!.data as ArrayBuffer);
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS test_saved_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
      sql.exec('INSERT OR REPLACE INTO test_saved_chunks (idx, data) VALUES (?, ?)', 0, original);
      sql.exec('DELETE FROM snapshot_chunks WHERE idx = 0');
      const damaged = new Uint8Array(original.length);
      damaged.fill(0xab);
      sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, damaged);
    });
    return true;
  }

  /** Test-only (spec task 9): restore the saved snapshot chunk 0. */
  repairSnapshotForTests(): boolean {
    const rows = this.storage.sql
      .exec('SELECT data FROM test_saved_chunks WHERE idx = 0')
      .toArray();
    if (rows.length === 0) return false;
    const original = new Uint8Array(rows[0]!.data as ArrayBuffer);
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec('DELETE FROM snapshot_chunks WHERE idx = 0');
      sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, original);
      sql.exec('DELETE FROM test_saved_chunks WHERE idx = 0');
    });
    return true;
  }

  // ---- internals ----

  private compact(doc: Y.Doc): boolean {
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const maxSeqRow = this.storage.sql
        .exec('SELECT COALESCE(MAX(seq), 0) AS m FROM updates')
        .toArray();
      const maxSeq = (maxSeqRow[0]?.m as number | undefined) ?? 0;
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]);
        }
        sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          META_THROUGH_SEQ,
          String(maxSeq),
        );
      });
      this.rowCount = 0;
      this.byteTotal = 0;
      return true;
    } catch (err) {
      console.error({ event: 'board-compaction-failed', error: String(err) });
      this.refreshCounters();
      return false;
    }
  }

  private quarantine(seq: number, data: Uint8Array, error: string): void {
    console.error({ event: 'board-update-quarantined', seq, error });
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
      sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
  }

  private metaValue(key: string): string | null {
    const rows = this.storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
    const value = rows[0]?.value;
    return typeof value === 'string' ? value : null;
  }

  /** Re-read counters from the log (after load / quarantine / rolled-back compaction). */
  private refreshCounters(): void {
    const row = this.storage.sql
      .exec('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM updates')
      .toArray();
    this.rowCount = (row[0]?.n as number | undefined) ?? 0;
    this.byteTotal = (row[0]?.b as number | undefined) ?? 0;
  }
}
