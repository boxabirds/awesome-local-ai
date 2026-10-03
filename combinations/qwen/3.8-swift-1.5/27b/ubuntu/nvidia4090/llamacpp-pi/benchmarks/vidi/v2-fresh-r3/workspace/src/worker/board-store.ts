/**
 * BoardStore: persists every Yjs update to a board's SQLite-backed Durable
 * Object storage, compacts the update log into a chunked snapshot, and reloads
 * on wake (quarantining damaged log rows).
 *
 * The pure helpers (`chunkBytes`, `joinChunks`, `shouldCompact`) are exercised
 * by the unit suite (node env); the `BoardStore` class runs only inside a
 * Durable Object (workerd). `DurableObjectStorage` is a type-only import so the
 * pure helpers stay importable in the node unit environment.
 *
 * workerd SQL API (2026): `sql.exec(sql, ...params)` binds variadically and
 * returns a Cursor (`one()` / `toArray()`); BLOBs bind as `Uint8Array` and are
 * read back as `ArrayBuffer`. `storage.transactionSync(fn)` rolls back on throw.
 */
import type { DurableObjectStorage } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Result of loading a board's persisted state into a Y.Doc.
 * - `ok:true` with the number of damaged log rows that were quarantined.
 * - `ok:false` when the snapshot is unreadable or SQL itself failed; the room
 *   then refuses to serve an empty doc (persist.load_failure).
 */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Origin tag applied to updates replayed from storage on load. The room's
 * update handler ignores updates with this origin, so a load never re-persists
 * or re-broadcasts what it just loaded (design state diagram: "R→S: load doc").
 */
export const LOAD_ORIGIN = 'board-store:load';

/** Splits `data` into chunks of at most `size` bytes (default SNAPSHOT_CHUNK_BYTES). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    chunks.push(data.subarray(i, i + size));
  }
  return chunks;
}

/** Concatenates `chunks` back into a single byte array, byte-identical to the input. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** True when the log has at least COMPACTION_UPDATE_COUNT rows or COMPACTION_BYTES total. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** Normalises a DB BLOB (ArrayBuffer) or a passed-in Uint8Array to a Uint8Array. */
function toBytes(v: ArrayBuffer | Uint8Array): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

/**
 * Safe single-row read: `one()` throws when the query returns zero rows, so
 * this returns `undefined` instead. (Aggregate queries like MAX always return
 * one row, so they are unaffected.)
 */
function oneRow<T>(sql: DurableObjectStorage['sql'], query: string, ...params: unknown[]): T | undefined {
  const rows = sql.exec(query, ...params).toArray<T>();
  return rows.length > 0 ? rows[0] : undefined;
}

/**
 * Persists a board's Yjs updates to Durable Object SQLite storage.
 *
 * Schema (one database per board):
 *   storage_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
 *   updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)
 *   snapshot_chunks(idx INTEGER PRIMARY KEY, data BLOB NOT NULL)
 *   quarantined_updates(seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)
 */
export class BoardStore {
  /** Rows in the active log (seq > snapshot_through_seq) currently tracked in memory. */
  private rowCount = 0;
  /** Total byte size of the active log, tracked in memory. */
  private byteTotal = 0;

  /**
   * TEST-ONLY: when true, the next `compactIfNeeded` throws right after
   * deleting the old snapshot chunks (inside its transaction) to exercise the
   * rollback path (TC-11). Consumed on first use. Never set in production.
   */
  __testFailCompactionAfterChunkDelete = false;

  constructor(private storage: DurableObjectStorage) {}

  /**
   * Creates the schema (idempotent) and sets storage_schema_version if absent.
   * Writes no update rows.
   */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
    `);
    const existing = oneRow<{ value: string }>(
      sql,
      'SELECT value FROM storage_meta WHERE key = ?',
      'storage_schema_version',
    );
    if (!existing) {
      sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        'storage_schema_version',
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /**
   * Appends an update row. Rethrows SQL errors so the caller can reset the
   * room (design state diagram: "R→S: insert; insert throws → storage-failed").
   */
  append(update: Uint8Array): void {
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.rowCount += 1;
    this.byteTotal += update.length;
  }

  /**
   * Loads the persisted state (snapshot + log rows beyond the snapshot) into
   * `doc`. Damaged log rows are quarantined and counted. Snapshot/SQL failures
   * return `ok:false` and delete nothing.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      this.migrate();
      const sql = this.storage.sql;

      // 1. Snapshot: read all chunks in order and apply as one update.
      const chunkRows = sql
        .exec('SELECT data FROM snapshot_chunks ORDER BY idx')
        .toArray<{ data: ArrayBuffer }>();
      if (chunkRows.length > 0) {
        const snapshotBytes = joinChunks(chunkRows.map((r) => toBytes(r.data)));
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return { ok: false, reason: 'snapshot-unreadable', error: String(e) };
        }
      }

      // 2. Log rows beyond the snapshot's through-seq, in seq order.
      const throughRow = oneRow<{ value: string }>(
        sql,
        'SELECT value FROM storage_meta WHERE key = ?',
        'snapshot_through_seq',
      );
      const throughSeq = throughRow ? parseInt(throughRow.value, 10) : 0;
      const logRows = sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq)
        .toArray<{ seq: number; data: ArrayBuffer }>();

      let quarantined = 0;
      let rowCount = 0;
      let byteTotal = 0;
      for (const row of logRows) {
        const data = toBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          rowCount += 1;
          byteTotal += data.length;
        } catch (e) {
          this.quarantine(row.seq, data, String(e));
          quarantined += 1;
        }
      }

      this.rowCount = rowCount;
      this.byteTotal = byteTotal;
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: String(e) };
    }
  }

  /** Moves a damaged log row to quarantined_updates (idempotent on seq). */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
    });
    console.error(
      JSON.stringify({ level: 'warn', msg: 'quarantined update row', seq, error }),
    );
  }

  /**
   * Compacts the log into a chunked snapshot when the thresholds are reached.
   * Never throws: on error it rolls back (log intact) and returns false.
   * Returns true when a compaction was written.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rowCount, this.byteTotal)) return false;
    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      const maxRow = oneRow<{ m: number | null }>(this.storage.sql, 'SELECT MAX(seq) AS m FROM updates');
      const maxSeq = maxRow?.m ?? 0;

      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        if (this.__testFailCompactionAfterChunkDelete) {
          this.__testFailCompactionAfterChunkDelete = false;
          throw new Error('injected compaction failure (test)');
        }
        chunks.forEach((chunk, idx) => {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
        });
        sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          'snapshot_through_seq',
          String(maxSeq),
        );
      });

      this.rowCount = 0;
      this.byteTotal = 0;
      return true;
    } catch (e) {
      console.error(
        JSON.stringify({ level: 'error', msg: 'compaction failed, rolled back, log intact', error: String(e) }),
      );
      return false;
    }
  }
}
