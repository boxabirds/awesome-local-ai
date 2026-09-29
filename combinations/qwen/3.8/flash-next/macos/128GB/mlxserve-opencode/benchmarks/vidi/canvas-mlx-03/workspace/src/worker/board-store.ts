// Durable storage for one board: an append-only log of Yjs updates plus a
// chunked snapshot, kept in the board's own SQLite-backed Durable Object
// storage.
//
// Only the *synchronous* SQLite surface (`storage.sql.exec` +
// `storage.transactionSync`) is used, so the row for an update is written in the
// same turn the update was applied — before it is broadcast (design
// persist.seen_is_saved). Damaged log rows are quarantined rather than fatal
// (design persist.partial_damage); an unreadable snapshot is fatal and deletes
// nothing (design persist.load_failure).
//
// The storage types here are structural slices of the platform interfaces rather
// than the global `DurableObjectStorage` type: this module is also imported by
// the plain-node unit tests (chunking / threshold maths), which run outside the
// Workers type environment. The object passed in at runtime is the real
// `DurableObjectStorage`.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config.ts';

/** A row value as returned by the Durable Object SQLite API. */
export type SqlValue = ArrayBuffer | string | number | null;

/** The synchronous cursor the storage API returns from `exec`. */
export interface SqlCursorLike {
  toArray(): Record<string, SqlValue>[];
}

/** The part of `storage.sql` this store uses. */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

/** The part of `DurableObjectStorage` this store uses. */
export interface BoardStorageLike {
  sql: SqlLike;
  transactionSync<T>(closure: () => T): T;
}

/**
 * Outcome of loading a saved board into a document.
 *
 * `ok: true` may still report `quarantined` log rows that could not be applied;
 * everything else loaded fine (design persist.partial_damage). `ok: false` means
 * the board must NOT be served as an empty board (design persist.load_failure).
 */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Transaction origin for updates applied while loading, so the room neither
 *  re-stores nor re-broadcasts them. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** `storage_meta` keys (design "Storage schema"). */
const META_SCHEMA_KEY = 'storage_schema_version';
const META_THROUGH_KEY = 'snapshot_through_seq';

const CREATE_TABLES = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function asBytes(value: SqlValue | undefined): Uint8Array {
  const raw = value as unknown;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(0);
}

function asNumber(value: SqlValue | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

/**
 * Split `data` into chunks of at most `size` bytes. Zero bytes yields no chunks.
 */
export function chunkBytes(
  data: Uint8Array,
  size: number = SNAPSHOT_CHUNK_BYTES,
): Uint8Array[] {
  if (size < 1) throw new RangeError('chunk size must be >= 1');
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    out.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return out;
}

/** Concatenate chunks back into one byte array (exact round-trip of chunkBytes). */
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

/** Whether the update log has grown past a compaction threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * One board's persisted state.
 *
 * Log row count and byte totals are tracked in memory after `load` so no
 * `COUNT(*)` runs per write.
 */
export class BoardStore {
  /** Rows currently held in the `updates` log. */
  logCount = 0;
  /** Total bytes of the rows currently held in the `updates` log. */
  logBytes = 0;
  /** Highest log seq written so far (0 when nothing was ever written). */
  lastSeq = 0;
  /** Log seq folded into the current snapshot (0 when there is no snapshot). */
  snapshotThrough = 0;

  private readonly db: SqlLike;

  constructor(readonly storage: BoardStorageLike) {
    this.db = storage.sql;
  }

  /**
   * Create the tables and stamp `storage_schema_version` when absent. Idempotent
   * and writes no update rows: a board that was merely opened but never edited
   * stays row-free (design persist.load_failure's "never-edited board").
   */
  migrate(): void {
    for (const statement of CREATE_TABLES) this.db.exec(statement);
    const found = this.db
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_SCHEMA_KEY)
      .toArray();
    if (found.length === 0) {
      this.db.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        META_SCHEMA_KEY,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /**
   * Append one Yjs update to the log. SQL errors are rethrown — the room resets
   * itself in that case (design persist.save_failure).
   */
  append(update: Uint8Array): void {
    const rows = this.db
      .exec(
        'INSERT INTO updates (data, bytes) VALUES (?, ?) RETURNING seq',
        update,
        update.length,
      )
      .toArray();
    const seq = asNumber(rows[0]?.seq) || this.lastSeq + 1;
    this.lastSeq = Math.max(this.lastSeq, seq);
    this.logCount += 1;
    this.logBytes += update.length;
  }

  /**
   * Load the snapshot and the log rows after it into `doc`.
   *
   * A damaged log row is moved to `quarantined_updates` inside its own
   * transaction and counted; the rest of the board still loads. A damaged
   * snapshot (or any SQL failure) returns `ok: false` and leaves every row
   * exactly as it was.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      const through = this.readThroughSeq();

      const chunkRows = this.db
        .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
        .toArray();
      if (chunkRows.length > 0) {
        const snapshot = joinChunks(chunkRows.map((r) => asBytes(r.data)));
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (err) {
          // Nothing is deleted or quarantined here: the log is still the only
          // readable copy of the board and must survive (negative scenario).
          return { ok: false, reason: 'snapshot-unreadable', error: errorMessage(err) };
        }
      }

      const rows = this.db
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', through)
        .toArray();
      let quarantined = 0;
      for (const row of rows) {
        const seq = asNumber(row.seq);
        const data = asBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (err) {
          this.quarantine(seq, data, errorMessage(err));
          quarantined += 1;
          // Structured log: the board opens with one change missing, and that
          // change is kept for a human to look at.
          console.error(
            JSON.stringify({
              event: 'quarantined-update',
              seq,
              bytes: data.length,
              error: errorMessage(err),
            }),
          );
        }
      }

      // Re-read the log totals once (not per write) so compaction decisions and
      // the next snapshot boundary are exact.
      const agg = this.db
        .exec(
          'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b, MAX(seq) AS m FROM updates',
        )
        .toArray()[0];
      this.logCount = asNumber(agg?.n);
      this.logBytes = asNumber(agg?.b);
      this.lastSeq = Math.max(through, asNumber(agg?.m));
      this.snapshotThrough = through;
      return { ok: true, quarantined };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: errorMessage(err) };
    }
  }

  /**
   * Fold the log into a fresh snapshot when it has crossed a threshold. Runs in a
   * single `transactionSync`, so a failure mid-way rolls back and leaves the
   * previous snapshot and the whole log intact. Never throws.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    let encoded: Uint8Array;
    try {
      // The in-memory doc already holds snapshot + log, so this is the board.
      encoded = Y.encodeStateAsUpdate(doc);
    } catch (err) {
      console.error(
        JSON.stringify({ event: 'compaction-failed', stage: 'encode', error: errorMessage(err) }),
      );
      return false;
    }
    const chunks = chunkBytes(encoded, SNAPSHOT_CHUNK_BYTES);
    const through = this.lastSeq;
    try {
      this.storage.transactionSync(() => {
        this.db.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          this.db.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]);
        }
        this.db.exec('DELETE FROM updates WHERE seq <= ?', through);
        this.db.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          META_THROUGH_KEY,
          String(through),
        );
      });
    } catch (err) {
      // The transaction rolled back: previous chunks and log rows are unchanged,
      // so the in-memory counters stay valid and we simply try again later.
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          stage: 'transaction',
          through,
          chunks: chunks.length,
          error: errorMessage(err),
        }),
      );
      return false;
    }
    this.snapshotThrough = through;
    this.logCount = 0;
    this.logBytes = 0;
    return true;
  }

  /** Move one unreadable log row out of the log, keeping it for inspection. */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.db.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
      this.db.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
  }

  private readThroughSeq(): number {
    const row = this.db
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_THROUGH_KEY)
      .toArray()[0];
    return typeof row?.value === 'string' ? Number(row.value) || 0 : 0;
  }

  // ------------------------------------------------------- test-only storage

  /**
   * TEST ONLY (design TC-24's e2e hook): damage the stored snapshot so that a load
   * fails, keeping the original bytes in a side table so `repairSnapshotForTests`
   * can put them back. The damage is real storage damage — a chunk that no longer
   * decodes — so the code that reports it is the production load path.
   *
   * Returns false when the board has no snapshot to damage (it is still LogOnly).
   */
  corruptSnapshotForTests(): boolean {
    if (this.countRows('snapshot_chunks') === 0) return false;
    this.storage.transactionSync(() => {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS test_snapshot_backup (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
      );
      this.db.exec('DELETE FROM test_snapshot_backup');
      this.db.exec(
        'INSERT INTO test_snapshot_backup (idx, data) SELECT idx, data FROM snapshot_chunks',
      );
      // Truncate the first chunk: the concatenated snapshot no longer decodes.
      this.db.exec("UPDATE snapshot_chunks SET data = x'00' WHERE idx = 0");
    });
    return true;
  }

  /**
   * TEST ONLY: put back the bytes `corruptSnapshotForTests` took away, so the board
   * becomes loadable again without the client reloading the page.
   *
   * Returns false when there is nothing backed up to restore.
   */
  repairSnapshotForTests(): boolean {
    if (this.countRows('test_snapshot_backup') === 0) return false;
    this.storage.transactionSync(() => {
      this.db.exec(
        'UPDATE snapshot_chunks SET data = (' +
          'SELECT data FROM test_snapshot_backup WHERE test_snapshot_backup.idx = snapshot_chunks.idx' +
          ') WHERE idx IN (SELECT idx FROM test_snapshot_backup)',
      );
      this.db.exec('DELETE FROM test_snapshot_backup');
    });
    return true;
  }

  /** Rows in one of this store's own tables, 0 if the table does not exist. */
  private countRows(table: 'snapshot_chunks' | 'test_snapshot_backup'): number {
    const exists = this.db
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table)
      .toArray();
    if (exists.length === 0) return 0;
    const row = this.db.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0];
    return Number(row?.n ?? 0);
  }
}
