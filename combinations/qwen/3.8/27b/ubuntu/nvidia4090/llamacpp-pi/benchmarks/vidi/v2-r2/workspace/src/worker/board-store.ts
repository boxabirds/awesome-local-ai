/**
 * BoardStore: durable storage for one board (story 4, design storage).
 *
 * SQLite schema (Durable Object storage, created by migrate() on wake):
 *
 *   storage_meta(key TEXT PRIMARY KEY, value TEXT)
 *     storage_schema_version  - version of these tables (never clobbered)
 *     snapshot_through_seq    - log rows with seq <= this are in the snapshot
 *   updates(seq INTEGER PK AUTOINCREMENT, data BLOB, bytes INTEGER)
 *     append-only Yjs update log; each row is one stored update (TC-04).
 *   snapshot_chunks(idx INTEGER PK, data BLOB)
 *     the compacted snapshot in <= SNAPSHOT_CHUNK_BYTES rows (TC-01/06).
 *   quarantined_updates(seq INTEGER PK, data BLOB, error TEXT, quarantined_at INTEGER)
 *     damaged log rows moved here verbatim during load (TC-07, TC-09).
 *
 * The room (board-room.ts) is the only caller: migrate + load on every
 * wake, append before every broadcast, compactIfNeeded after appends.
 *
 * `storage` is a public wrapper so tests can inject failures (TC-14/TC-26)
 * by replacing it; production passes the Durable Object's own storage.
 */

import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config';
import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../shared/storage-chunks';

export { chunkBytes, joinChunks, shouldCompact } from '../shared/storage-chunks';

/**
 * Origin for every document write the room itself applies (load, local
 * schema init). Updates with this origin are never appended to storage:
 * they are derived from storage (load) or owned by the room (meta), not
 * client edits (TC-25).
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load-origin');

/**
 * The Durable Object SQLite surface BoardStore calls (workerd's cursor-based
 * `exec` API; the installed workers-types describe exactly this shape).
 * BLOBs bind as Uint8Array and come back as ArrayBuffer.
 */
export interface BoardSqlCursor {
  columnNames: string[];
  rowsRead: number;
  rowsWritten: number;
  next(): { done: false; value: Record<string, unknown> } | { done: true; value?: undefined };
  toArray(): Record<string, unknown>[];
  /** Throws when the query returns zero rows (workerd). */
  one(): Record<string, unknown>;
}

export interface BoardSql {
  exec(query: string, ...bindings: unknown[]): BoardSqlCursor;
  readonly databaseSize: number;
}

/** The storage surface BoardStore needs (wrappable by tests for TC-14/TC-26). */
export interface BoardStorage {
  sql: BoardSql;
  transactionSync(fn: () => void): void;
}

/** Adapts a Durable Object's storage to BoardStore's structural surface. */
export function fromStorage(storage: { sql: unknown; transactionSync(fn: () => void): void }): BoardStorage {
  return {
    sql: storage.sql as BoardSql,
    // Keep the original receiver: the native method throws "Illegal
    // invocation" when called with a detached `this`.
    transactionSync: storage.transactionSync.bind(storage),
  };
}

/** A completed board load: success (with quarantine count) or a failure reason. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

interface UpdateRow {
  seq: number;
  data: Uint8Array;
  bytes: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** First row of a query, or null (one() throws on zero rows). */
function firstRow(sql: BoardSql, query: string, ...bindings: unknown[]): Record<string, unknown> | null {
  const rows = sql.exec(query, ...bindings).toArray();
  return rows.length > 0 ? rows[0] : null;
}

function allRows(sql: BoardSql, query: string, ...bindings: unknown[]): Record<string, unknown>[] {
  return sql.exec(query, ...bindings).toArray();
}

function blobOf(row: Record<string, unknown>, column: string): Uint8Array {
  const value = row[column];
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return value as Uint8Array;
}

export class BoardStore {
  /** Public (not a private field) so tests can swap in a failing storage. */
  storage: BoardStorage;

  /** Rows in the update log (in memory; recomputed from storage on load). */
  private logRows = 0;
  /** Bytes in the update log (in memory; recomputed from storage on load). */
  private logBytes = 0;
  /** True once migrate() has run on this instance (story 5: lazy migrate). */
  private migrated = false;

  constructor(storage: BoardStorage) {
    this.storage = storage;
  }

  /**
   * Creates the tables if missing (IF NOT EXISTS) and records the storage
   * schema version only when absent. An existing — possibly unknown —
   * version is left alone: migration preserves data (TC-10).
   *
   * Story 5: no longer runs on every construct — only from `initialize()`
   * (new boards) and lazily before the first `append()` (legacy boards
   * already have their tables). Probing an unknown link writes nothing.
   */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); ' +
        'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL); ' +
        'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL); ' +
        'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);',
    );
    const existing = firstRow(sql, 'SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version');
    if (existing === null) {
      // (exec runs the statement immediately; toArray drains the write cursor.)
      sql
        .exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', 'storage_schema_version', String(STORAGE_SCHEMA_VERSION))
        .toArray();
    }
    this.migrated = true;
  }

  /**
   * Read-only existence check (story 5, share.board_api): a board exists if
   * its storage has `created_at`, or (legacy, share.legacy_boards) at least
   * one row in `updates` or `snapshot_chunks`. Queries `sqlite_master`
   * first and NEVER creates tables, so checking a link for an unknown board
   * leaves no storage behind (TC-06/TC-09).
   */
  existsReadOnly(): boolean {
    const sql = this.storage.sql;
    try {
      const tables = new Set(
        sql
          .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
          .toArray()
          .map((row) => String(row.name)),
      );
      if (tables.has('storage_meta')) {
        const meta = sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray();
        if (meta.length > 0) {
          return true;
        }
      }
      for (const table of ['updates', 'snapshot_chunks'] as const) {
        if (!tables.has(table)) {
          continue;
        }
        const row = sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).toArray()[0];
        if (row !== undefined && Number(row.c ?? 0) > 0) {
          return true;
        }
      }
      return false;
    } catch {
      // Storage that cannot even be read cannot prove existence. The room's
      // load path reports the real failure to clients; a probe must not
      // write, so "unknown" is the only safe answer here.
      return false;
    }
  }

  /**
   * Appends one Yjs update as the next log row. Throws on storage failure
   * — the caller (the room) treats that as "storage failed" and resets.
   *
   * Story 5: runs migrate() lazily on the first append, so a legacy board
   * (tables from before this feature) or a never-initialized object that
   * somehow receives an update still stores it correctly.
   */
  append(update: Uint8Array): void {
    if (!this.migrated) {
      this.migrate();
    }
    this.storage.sql
      .exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.byteLength)
      .toArray();
    this.logRows += 1;
    this.logBytes += update.byteLength;
  }

  /**
   * Loads the board into `doc` (a fresh document owned by the caller):
   * snapshot chunks in idx order, then log rows above snapshot_through_seq
   * in seq order. Never throws:
   *
   * - SQL itself fails            -> { ok: false, reason: 'sql-error' }
   * - snapshot fails to apply     -> { ok: false, reason: 'snapshot-unreadable' }
   * - a log row fails to apply    -> quarantined verbatim, load continues
   *
   * On success the in-memory log counters reflect the rows still in the log.
   */
  load(doc: Y.Doc): LoadResult {
    const sql = this.storage.sql;
    let chunkData: Uint8Array[];
    let updateRows: UpdateRow[];
    let throughSeq: number;
    try {
      // Story 5: construct no longer migrates (probing an unknown link must
      // write nothing), so a board with no data tables at all loads as an
      // empty board instead of failing with a missing-table SQL error.
      const tables = new Set(
        sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((row) => String(row.name)),
      );
      if (!tables.has('updates') && !tables.has('snapshot_chunks')) {
        this.logRows = 0;
        this.logBytes = 0;
        return { ok: true, quarantined: 0 };
      }
      const chunkRows = allRows(sql, 'SELECT data FROM snapshot_chunks ORDER BY idx');
      chunkData = chunkRows.map((r) => blobOf(r, 'data'));
      const through = firstRow(sql, 'SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq');
      throughSeq = through === null || through.value === null ? 0 : Number(through.value);
      updateRows = allRows(
        sql,
        'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq',
        throughSeq,
      ).map((r) => ({
        seq: Number(r.seq),
        data: blobOf(r, 'data'),
        bytes: Number(r.bytes),
      }));
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describeError(error) };
    }

    if (chunkData.length > 0) {
      try {
        Y.applyUpdate(doc, joinChunks(chunkData), LOAD_ORIGIN);
      } catch (error) {
        return {
          ok: false,
          reason: 'snapshot-unreadable',
          error: describeError(error),
        };
      }
    }

    let quarantined = 0;
    let rows = 0;
    let rowBytes = 0;
    for (const row of updateRows) {
      try {
        Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
      } catch (error) {
        quarantined += 1;
        try {
          this.quarantine(row.seq, row.data, describeError(error));
        } catch (quarantineError) {
          // Quarantine itself failed (storage is going bad): leave the row
          // in place so the next load retries it; the board still loads.
          console.error(
            'BoardStore: failed to quarantine damaged update; keeping row',
            { seq: row.seq, error: describeError(quarantineError) },
          );
          rows += 1;
          rowBytes += row.bytes;
        }
        continue;
      }
      rows += 1;
      rowBytes += row.bytes;
    }
    this.logRows = rows;
    this.logBytes = rowBytes;
    return { ok: true, quarantined };
  }

  /** True when the in-memory log counters have crossed a compaction threshold. */
  needsCompaction(): boolean {
    return shouldCompact(this.logRows, this.logBytes);
  }

  /**
   * Compacts (snapshot + truncate log) when shouldCompact says the log is
   * big enough. The whole swap is one storage transaction: new chunks in,
   * snapshot_through_seq set, old rows out — a mid-compaction failure
   * leaves the previous snapshot+log intact (TC-06) and returns false.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logRows, this.logBytes)) {
      return false;
    }
    const maxRow = firstRow(this.storage.sql, 'SELECT MAX(seq) AS m FROM updates');
    const maxSeq = maxRow === null || maxRow.m === null ? 0 : Number(maxRow.m);
    const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
    try {
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
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
      this.logRows = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      console.error('BoardStore: compaction failed; keeping the previous snapshot and log', {
        error: describeError(error),
      });
      return false;
    }
  }

  /** Moves one damaged log row to the quarantine table (TC-07). */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec('DELETE FROM updates WHERE seq = ?', seq).toArray();
      sql
        .exec(
          'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          data,
          error,
          Date.now(),
        )
        .toArray();
    });
  }
}
