// Board storage (story 4, persist.board_store): SQL schema, append, load
// (with quarantine of damaged rows) and chunked compaction over the
// Durable Object's SQLite-backed storage. One database per board.
//
// Schema (one database per board):
//   storage_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
//     keys: storage_schema_version, snapshot_through_seq
//   updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL,
//           bytes INTEGER NOT NULL)
//   snapshot_chunks(idx INTEGER PRIMARY KEY, data BLOB NOT NULL)
//   quarantined_updates(seq INTEGER PRIMARY KEY, data BLOB NOT NULL,
//                       error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)
//
// Key decisions (design):
// - append rethrows SQL errors: the caller (BoardRoom) resets the room,
//   so an unconfirmed write is never treated as durable.
// - load quarantines damaged LOG rows (a single bad change must not lose
//   the board) but fails the whole load for an unreadable SNAPSHOT
//   (most of the board would be unreadable — serve LoadFailed, not empty).
// - compactIfNeeded never throws: a failed transaction rolls back, the
//   previous snapshot and log stay intact, and the result is false.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Origin for updates applied while loading storage into a doc: such
 *  updates are neither re-stored nor broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load-origin');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Splits `data` into contiguous slices of at most `size` bytes (the last
 *  chunk may be shorter). Zero input yields zero chunks. */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return chunks;
}

/** Inverse of chunkBytes: concatenates the chunks byte-identically. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Compaction threshold: enough rows OR enough bytes (design boundary). */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/* --- Test seams (integration tests run in the same isolate) ---
 * Each seam is a hook the room (or a test) can set once; it fires at the
 * named point and is then cleared. They sit OUTSIDE SQLite, so real
 * transaction semantics (rollback, row movement) still apply. */
let appendFault: (() => void) | null = null;
let loadReadFault: (() => void) | null = null;
let compactionFault: (() => void) | null = null;

export function __testSetAppendFault(fault: (() => void) | null): void {
  appendFault = fault;
}

export function __testSetLoadReadFault(fault: (() => void) | null): void {
  loadReadFault = fault;
}

export function __testSetCompactionFault(fault: (() => void) | null): void {
  compactionFault = fault;
}

/** `cursor.one()` (this workerd) throws when the query has no row. */
function oneRow<T extends Record<string, SqlStorageValue>>(cursor: SqlStorageCursor<T>): T | null {
  try {
    return cursor.one();
  } catch {
    return null;
  }
}

export class BoardStore {
  private storage: DurableObjectStorage;
  /** Rows with seq > snapshot_through_seq, tracked in memory after load so
   *  appends never need COUNT(*). */
  private logCount = 0;
  private logBytes = 0;
  /** Max seq in the log (snapshot_through_seq when the log is empty). */
  private lastSeq = 0;
  private throughSeq = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  /** Creates the tables and sets storage_schema_version if absent.
   *  Writes no update rows: a never-edited board opened by someone stays
   *  row-free (TC-25). */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    const row = oneRow(sql.exec<{ value: string }>(
      'SELECT value FROM storage_meta WHERE key = ?',
      'storage_schema_version',
    ));
    if (row === null) {
      sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        'storage_schema_version',
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /** Appends one applied Yjs update to the log. Rethrows SQL errors so the
   *  caller can reset the room (persist.save_failure). */
  append(update: Uint8Array): void {
    const fault = appendFault;
    if (fault !== null) {
      appendFault = null; // one-shot
      fault();
    }
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    const row = oneRow(this.storage.sql.exec<{ seq: number }>('SELECT last_insert_rowid() AS seq'));
    this.lastSeq = row === null ? this.lastSeq : row.seq;
    this.logCount += 1;
    this.logBytes += update.length;
  }

  /** Loads the stored board into `doc` (applied with LOAD_ORIGIN): first the
   *  snapshot chunks, then every log row with seq > snapshot_through_seq.
   *  A damaged log row is quarantined (moved out of `updates` in one
   *  transaction) and counted; the rest apply. An unreadable snapshot or a
   *  SQL failure returns ok:false with nothing deleted or quarantined. */
  load(doc: Y.Doc): LoadResult {
    // Which phase is in flight decides the failure reason: a throw while
    // applying the snapshot is 'snapshot-unreadable'; a throw in any SQL
    // statement is 'sql-error'. Damaged log rows are quarantined inside the
    // loop and never reach the catch.
    let phase: 'sql' | 'snapshot' = 'sql';
    try {
      const readFault = loadReadFault;
      if (readFault !== null) {
        loadReadFault = null; // one-shot
        readFault();
      }
      const sql = this.storage.sql;
      const meta = oneRow(sql.exec<{ value: string }>(
        'SELECT value FROM storage_meta WHERE key = ?',
        'snapshot_through_seq',
      ));
      this.throughSeq = meta === null ? 0 : Number(meta.value);

      const chunks: Uint8Array[] = [];
      for (const row of sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')) {
        chunks.push(new Uint8Array(row.data));
      }
      if (chunks.length > 0) {
        phase = 'snapshot';
        Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
      }

      const rows: { seq: number; data: Uint8Array; bytes: number }[] = [];
      for (const row of sql.exec<{ seq: number; data: ArrayBuffer; bytes: number }>(
        'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq',
        this.throughSeq,
      )) {
        rows.push({ seq: row.seq, data: new Uint8Array(row.data), bytes: row.bytes });
      }
      let quarantined = 0;
      let applied = 0;
      let appliedBytes = 0;
      let appliedMaxSeq = this.throughSeq;
      for (const row of rows) {
        try {
          Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
          applied += 1;
          appliedBytes += row.bytes;
          appliedMaxSeq = row.seq;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.storage.transactionSync(() => {
            this.storage.sql.exec(
              'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq,
              row.data,
              message,
              Date.now(),
            );
            this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
          });
          quarantined += 1;
          console.error({ event: 'board-store-quarantine', seq: row.seq, error: message });
        }
      }
      this.logCount = applied;
      this.logBytes = appliedBytes;
      this.lastSeq = appliedMaxSeq;
      return { ok: true, quarantined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: phase === 'snapshot' ? 'snapshot-unreadable' : 'sql-error', error: message };
    }
  }

  /** True when the in-memory log counters say compaction is due (so the
   *  room can track the Compacting state transition). */
  shouldCompactNow(): boolean {
    return this.logCount > 0 && shouldCompact(this.logCount, this.logBytes);
  }

  /** Compacts the log into a new chunked snapshot, inside a single
   *  transaction: replace the chunks, truncate the log, advance
   *  snapshot_through_seq. Never throws: any failure rolls the transaction
   *  back (previous snapshot and log intact), is logged, and returns false.
   *  Returns true when a compaction happened. */
  compact(doc: Y.Doc): boolean {
    // Read the max seq from storage (not the in-memory counter): a room
    // woken from hibernation has a fresh counter but the old rows.
    const maxRow = oneRow(
      this.storage.sql.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates'),
    );
    const maxSeq = maxRow === null || maxRow.m === null ? 0 : Number(maxRow.m);
    try {
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((data, idx) => {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, data);
        });
        const compaction = compactionFault;
        if (compaction !== null) {
          compactionFault = null; // one-shot
          compaction(); // fault after the chunk delete
        }
        sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          String(maxSeq),
        );
      });
      this.throughSeq = maxSeq;
      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (err) {
      console.error({ event: 'board-store-compaction-failed', error: String(err) });
      return false;
    }
  }

  /** Compacts when the in-memory log counters crossed a threshold (the
   *  production path, called by the room after each stored update). */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.shouldCompactNow()) return false;
    return this.compact(doc);
  }
}
