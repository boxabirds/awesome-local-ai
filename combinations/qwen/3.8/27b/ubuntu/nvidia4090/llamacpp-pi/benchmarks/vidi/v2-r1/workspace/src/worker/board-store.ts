// BoardStore (story 4, persist.board_store contract): the persistence layer
// for a board's Y.Doc on top of the Durable Object's SQLite storage.
//
// Layout (one database per board, created by migrate()):
//   storage_meta        (key, value)                -- storage_schema_version, snapshot_through_seq
//   updates             (seq AUTOINCREMENT, data, bytes)  -- append-only update log
//   snapshot_chunks     (idx, data)                 -- chunked full-state snapshot
//   quarantined_updates (seq, data, error, quarantined_at) -- damaged log rows
//
// The SQL surface used here is the Durable Object SQLite `sql.exec` API
// (bindings supported, cursors for SELECTs; no prepare/execute in this
// runtime build).
//
// Guarantees:
// - append() throws on SQL failure; the caller (BoardRoom) then closes
//   connections with 1011 and discards the in-memory doc (persist.room).
// - load() never throws: a damaged snapshot => { ok: false, reason:
//   'snapshot-unreadable' }; a damaged log row is quarantined (moved to
//   quarantined_updates, removed from updates) and the load keeps going;
//   a SQL failure => { ok: false, reason: 'sql-error' }.
// - compactIfNeeded() never throws: a storage failure rolls the transaction
//   back (snapshot and log stay intact) and it returns false.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin used when replaying persisted state into the in-memory
 * doc (load). Updates that come in with this origin are never appended to
 * the log again or broadcast.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.boardStore.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Test hooks: fault injection points that sit outside SQLite, so real
 * transaction semantics still apply (TC-11, TC-26). */
export interface BoardStoreFaults {
  /** Called inside the compaction transaction, after the old snapshot chunks
   * are deleted. Throwing simulates a storage failure mid-compaction. */
  afterSnapshotReplaced?(): void;
}

/** Split `data` into chunks of at most `size` bytes (the last may be shorter). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/** Inverse of chunkBytes: concatenate chunks into one byte array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when an update log of `count` rows / `bytes` bytes has reached a compaction threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** SQLite-backed blobs come back as ArrayBuffer (or, depending on the runtime
 * build, Uint8Array); normalize to a copied Uint8Array. */
export function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new Error(`unexpected blob value: ${String(value)}`);
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';
/** Story 5 (share.board_api): written once by BoardRoom.initialize(); its
 * presence marks a board as created. Legacy boards (pre-story-5) never have
 * it and count as existing by their updates/snapshot rows instead. */
export const META_CREATED_AT = 'created_at';

/** First row of a SELECT, or null. (cursor.one() throws on 0 and 2+ rows.) */
export function firstRow<T extends Record<string, SqlStorageValue>>(
  sql: SqlStorage,
  query: string,
  ...bindings: unknown[]
): T | null {
  const first = sql.exec<T>(query, ...bindings).next();
  return first.done ? null : first.value;
}

const MIGRATIONS = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

export class BoardStore {
  private readonly storage: DurableObjectStorage;
  private readonly faults: BoardStoreFaults;
  private logCount = 0;
  private logBytes = 0;
  /** Story 5: migrate() no longer runs on construct (probing an unknown link
   * must write nothing); it runs from initialize() and lazily here. */
  private tablesReady = false;

  constructor(storage: DurableObjectStorage, faults: BoardStoreFaults = {}) {
    this.storage = storage;
    this.faults = faults;
  }

  /** Create tables and record the schema version. Writes no update rows.
   * Idempotent; safe to call from multiple paths (initialize, first append). */
  migrate(): void {
    if (this.tablesReady) return;
    this.runMigrations();
    this.tablesReady = true;
  }

  private runMigrations(): void {
    const sql = this.storage.sql;
    for (const statement of MIGRATIONS) sql.exec(statement);
    const row = firstRow<{ value: string }>(sql, 'SELECT value FROM storage_meta WHERE key = ?1', META_SCHEMA_VERSION);
    if (row === null) {
      sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?1, ?2)',
        META_SCHEMA_VERSION,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /** Story 5 (share.board_api): read-only existence check. A board exists if
   * its storage has storage_meta.created_at, or (legacy) at least one row in
   * updates or snapshot_chunks. Queries sqlite_master first and never creates
   * tables, so probing a link to an unknown board leaves no storage behind. */
  existsReadOnly(): boolean {
    const sql = this.storage.sql;
    const tables = this.tableNames();
    if (tables.has('storage_meta')) {
      const meta = firstRow<{ value: string }>(sql, 'SELECT value FROM storage_meta WHERE key = ?1', META_CREATED_AT);
      if (meta !== null) return true;
    }
    if (tables.has('updates')) {
      const row = firstRow<{ n: number | null }>(sql, 'SELECT COUNT(*) AS n FROM updates');
      if (row !== null && (row.n ?? 0) > 0) return true;
    }
    if (tables.has('snapshot_chunks')) {
      const row = firstRow<{ n: number | null }>(sql, 'SELECT COUNT(*) AS n FROM snapshot_chunks');
      if (row !== null && (row.n ?? 0) > 0) return true;
    }
    return false;
  }

  /** Story 5 test hook (TC-31): seed a pre-story-5 board — the story 4
   * schema and an updates row, but no created_at (legacy board). */
  seedLegacy(update: Uint8Array): void {
    this.migrate();
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?1, ?2)', update, update.length);
  }

  /** The names of the tables that currently exist in this board's database. */
  private tableNames(): Set<string> {
    const rows = this.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray();
    return new Set(rows.map((row) => row.name));
  }

  /** Rows/bytes currently in the update log (tracked in memory after load;
   * updated by append/compaction). */
  get logStats(): { count: number; bytes: number } {
    return { count: this.logCount, bytes: this.logBytes };
  }

  compactionDue(): boolean {
    return shouldCompact(this.logCount, this.logBytes);
  }

  /** Append one Yjs update to the log. Throws on SQL failure (the caller must
   * then fail the room over: close 1011 and discard the in-memory doc).
   * Migrates lazily before the first append (story 5: legacy boards already
   * have tables; fresh boards are migrated by initialize() or here). */
  append(update: Uint8Array): void {
    this.migrate();
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?1, ?2)', update, update.length);
    this.logCount += 1;
    this.logBytes += update.length;
  }

  /** Load the persisted state (snapshot, then log rows) into `doc`. Never throws:
   * a damaged snapshot is a load failure, a damaged log row is quarantined and
   * skipped, a SQL failure is a load failure. Story 5: missing tables are an
   * empty board (an unknown link is never a load failure) and nothing is
   * created. */
  load(doc: Y.Doc): LoadResult {
    const sql = this.storage.sql;
    try {
      const tables = this.tableNames();
      if (!tables.has('storage_meta') && !tables.has('updates') && !tables.has('snapshot_chunks')) {
        // Unknown board: no tables, nothing persisted → empty board, no writes.
        this.logCount = 0;
        this.logBytes = 0;
        return { ok: true, quarantined: 0 };
      }

      let throughSeq = 0;
      if (tables.has('storage_meta')) {
        const throughRow = firstRow<{ value: string }>(sql, 'SELECT value FROM storage_meta WHERE key = ?1', META_SNAPSHOT_THROUGH_SEQ);
        throughSeq = throughRow === null ? 0 : Number(throughRow.value);
      }

      if (tables.has('snapshot_chunks')) {
        const chunkRows = sql
          .exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')
          .toArray();
        if (chunkRows.length > 0) {
          const snapshot = joinChunks(chunkRows.map((row) => toUint8Array(row.data)));
          try {
            Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
          } catch (error) {
            console.error({ event: 'board_store.snapshot_unreadable', error: errorMessage(error) });
            return { ok: false, reason: 'snapshot-unreadable', error: errorMessage(error) };
          }
        }
      }

      const rows = tables.has('updates') ? this.readLogRows(throughSeq) : [];
      let quarantined = 0;
      let keptBytes = 0;
      for (const row of rows) {
        const data = toUint8Array(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          keptBytes += row.bytes;
        } catch (error) {
          quarantined += 1;
          this.storage.transactionSync(() => {
            sql.exec(
              'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)',
              row.seq,
              data,
              errorMessage(error),
              Date.now(),
            );
            sql.exec('DELETE FROM updates WHERE seq = ?1', row.seq);
          });
          console.error({ event: 'board_store.update_quarantined', seq: row.seq, error: errorMessage(error) });
        }
      }
      this.logCount = rows.length - quarantined;
      this.logBytes = keptBytes;
      return { ok: true, quarantined };
    } catch (error) {
      console.error({ event: 'board_store.load_sql_error', error: errorMessage(error) });
      return { ok: false, reason: 'sql-error', error: errorMessage(error) };
    }
  }

  /** Compact the log into a new chunked snapshot when a threshold is reached.
   * Never throws: a storage failure rolls the transaction back (snapshot and
   * log stay intact) and returns false. Returns true when a new snapshot
   * replaced the log. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.compactionDue()) return false;
    return this.compact(doc);
  }

  /** Force a compaction (test hook). Same guarantees as compactIfNeeded. */
  compact(doc: Y.Doc): boolean {
    if (this.logCount === 0) return false;
    const sql = this.storage.sql;
    const maxRow = firstRow<{ m: number | null }>(sql, 'SELECT MAX(seq) AS m FROM updates');
    const maxSeq = maxRow?.m ?? 0;
    const snapshot = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(snapshot);
    try {
      this.storage.transactionSync(() => {
        sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i += 1) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)', i, chunks[i]);
        }
        this.faults.afterSnapshotReplaced?.();
        sql.exec('DELETE FROM updates WHERE seq <= ?1', maxSeq);
        sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2',
          META_SNAPSHOT_THROUGH_SEQ,
          String(maxSeq),
        );
      });
    } catch (error) {
      console.error({ event: 'board_store.compaction_failed', error: errorMessage(error) });
      return false;
    }
    this.logCount = 0;
    this.logBytes = 0;
    return true;
  }

  /** The log rows after `throughSeq`, in order. A separate method so tests
   * can make this SELECT throw (TC-26: the sql-error load path). */
  private readLogRows(throughSeq: number): Array<{ seq: number; data: ArrayBuffer; bytes: number }> {
    return this.storage.sql
      .exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        'SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq',
        throughSeq,
      )
      .toArray();
  }
}
