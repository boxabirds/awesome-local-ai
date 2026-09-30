// Board storage: the SQLite schema every board keeps inside its own Durable
// Object, and the three operations the room needs - `append` (one update, written
// before anyone is told about it), `load` (snapshot + log into a document, on
// wake) and `compactIfNeeded` (fold the log into a chunked snapshot).
//
// Why it is shaped this way
//   - Saving is continuous: every applied update is appended here, so there is
//     no save button to forget (persist.automatic) and nothing is lost when the
//     last person leaves or the service restarts (persist.restart).
//   - Damage is contained. One unreadable log row is moved to
//     `quarantined_updates` and the rest of the board still opens
//     (persist.partial_damage). An unreadable *snapshot* is different: most of
//     the board is unreadable, so `load` reports `ok: false` rather than handing
//     back a deceptively empty document (persist.load_failure).
//   - Compaction is transactional: a failure rolls back and leaves the previous
//     snapshot and the whole log exactly as they were.
//
// The storage surface is declared structurally (`BoardDatabase`) rather than by
// the Workers global name so this module - and the unit tests for its pure
// functions - also compile in the browser type-checking program. A real
// `DurableObjectStorage` satisfies it.

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin of every update applied while loading. The room skips
 * storing and broadcasting updates whose origin is this, so loading a board
 * never re-writes what it just read (and never re-broadcasts it).
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/**
 * `storage_meta` keys. Both are exported because the tests assert on them and the
 * test hooks report them. `snapshot_through_seq` is the join between the snapshot
 * and the log: log rows with a higher `seq` are the ones a load still applies.
 */
export const META_SCHEMA_VERSION = 'storage_schema_version';
export const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';

export const CREATE_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS updates (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     data BLOB NOT NULL,
     bytes INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS quarantined_updates (
     seq INTEGER PRIMARY KEY,
     data BLOB NOT NULL,
     error TEXT NOT NULL,
     quarantined_at INTEGER NOT NULL
   )`,
];

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** One row-shaped result object; values are what SQLite can hand back. */
export type SqlRow = Record<string, unknown>;

/** The cursor `exec` returns. Rows must be consumed before the next statement. */
export interface BoardCursor extends Iterable<SqlRow> {
  one(): SqlRow;
}

/** The slice of `DurableObjectStorage` this store uses. */
export interface BoardDatabase {
  readonly sql: {
    exec(query: string, ...params: unknown[]): BoardCursor;
  };
  transactionSync<T>(closure: () => T): T;
}

/** Split `data` into chunks of at most `size` bytes (no empty trailing chunk). */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    out.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return out;
}

/** The chunks back to one byte string, byte for byte. */
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

/** Whether the update log has grown past either compaction threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** Bytes as SQLite hands them back (an ArrayBuffer, or a view over one). */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`expected a BLOB, got ${typeof value}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * The board's SQLite storage. One instance per Durable Object instance; it keeps
 * the log's row count and byte total in memory after a load so the compaction
 * threshold costs nothing per write.
 */
/** Un-compacted log rows and bytes, the two numbers the compaction threshold reads. */
export interface PendingLog {
  count: number;
  bytes: number;
}

export class BoardStore {
  private readonly sql: BoardDatabase['sql'];
  private readonly storage: BoardDatabase;
  /** Log rows and bytes currently stored (tracked to avoid COUNT(*) per write). */
  private logCount = 0;
  private logBytes = 0;

  /**
   * Test seam, unset in production: called with the SQL of every statement this
   * store is about to run, and may throw. Throwing there is how the integration
   * tests make a read or a write fail the way a real database fails - the failure
   * lands at the SQL boundary, so SQLite's own transaction semantics still apply
   * around it (TC-11, TC-14, TC-26).
   */
  beforeStatement?: (query: string) => void;

  constructor(storage: BoardDatabase) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  /**
   * One statement, through the seam. Every query the store runs goes here so a
   * test can make this particular kind of failure happen on demand.
   */
  private run(query: string, ...params: unknown[]): BoardCursor {
    this.beforeStatement?.(query);
    return this.sql.exec(query, ...params);
  }

  /** Create the tables and record the storage schema version. Writes no data rows. */
  migrate(): void {
    for (const statement of CREATE_TABLES) this.run(statement);
    // Set only when absent: a board written by a newer build (a higher schema
    // version) must not be silently rewritten down to this build's version.
    this.run(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?1, ?2)`,
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /**
   * Append one update to the log. Throws on a SQL failure (the caller resets the
   * room); the counters only move once the row is in.
   */
  append(update: Uint8Array): void {
    this.run(`INSERT INTO updates (data, bytes) VALUES (?1, ?2)`, update, update.byteLength);
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  /** Fill `doc` with everything stored: snapshot first, then the newer log rows. */
  load(doc: Y.Doc): LoadResult {
    try {
      const through = this.metaNumber(META_SNAPSHOT_THROUGH);

      // 1. the snapshot, if one has ever been compacted
      const chunks = [...this.run(`SELECT data FROM snapshot_chunks ORDER BY idx`)].map(
        (row) => asBytes(row.data),
      );
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (error) {
          // Most of the board is unreadable. Saying so is the whole point: the
          // room must not serve this document as if the board were empty, and
          // nothing may be deleted or quarantined on the way out.
          return { ok: false, reason: 'snapshot-unreadable', error: errorMessage(error) };
        }
      }

      // 2. the log rows newer than the snapshot, oldest first. The rows are read
      //    out in full first: a SQLite cursor must be finished before a write.
      const rows = [
        ...this.run(
          `SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq`,
          through,
        ),
      ];
      let quarantined = 0;
      let applied = 0;
      let appliedBytes = 0;
      for (const row of rows) {
        const seq = Number(row.seq);
        const update = asBytes(row.data);
        const size = Number(row.bytes);
        try {
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
          applied += 1;
          appliedBytes += size;
        } catch (error) {
          const reason = errorMessage(error);
          // One damaged change inside an otherwise healthy board: move that row
          // aside and keep everything else. Only this row is touched.
          this.storage.transactionSync(() => {
            this.run(
              `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at)
               VALUES (?1, ?2, ?3, ?4)`,
              seq,
              update,
              reason,
              Date.now(),
            );
            this.run(`DELETE FROM updates WHERE seq = ?1`, seq);
          });
          quarantined += 1;
          console.error(
            JSON.stringify({ event: 'board-update-quarantined', seq, error: reason }),
          );
        }
      }

      this.logCount = applied;
      this.logBytes = appliedBytes;
      return { ok: true, quarantined };
    } catch (error) {
      // SQL itself failed (unreadable table, unusable binding). Treated exactly
      // like an unreadable board: the room refuses to serve it rather than show
      // an empty one.
      return { ok: false, reason: 'sql-error', error: errorMessage(error) };
    }
  }

  /**
   * Fold the log into a fresh snapshot when it has grown; never throws.
   *
   * `force` skips the threshold check. It exists for the test-only corruption
   * hook, which needs a snapshot to damage on a board too small to have compacted
   * yet; nothing in the room's own path uses it.
   */
  compactIfNeeded(doc: Y.Doc, { force = false }: { force?: boolean } = {}): boolean {
    if (!force && !shouldCompact(this.logCount, this.logBytes)) return false;
    try {
      // The document in memory already holds snapshot + log, so encoding it is
      // the new snapshot; Yjs garbage-collects deleted content, so its size
      // tracks the board's current content rather than its whole history.
      const snapshot = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(snapshot);
      const maxSeq = Number(this.run(`SELECT MAX(seq) AS max_seq FROM updates`).one().max_seq ?? 0);
      if (!(maxSeq > 0)) return false;

      this.storage.transactionSync(() => {
        this.run(`DELETE FROM snapshot_chunks`);
        for (let idx = 0; idx < chunks.length; idx++) {
          this.run(`INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)`, idx, chunks[idx]);
        }
        this.run(`DELETE FROM updates WHERE seq <= ?1`, maxSeq);
        this.run(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?1, ?2)`,
          META_SNAPSHOT_THROUGH,
          String(maxSeq),
        );
      });

      this.logCount = 0;
      this.logBytes = 0;
      return true;
    } catch (error) {
      // transactionSync has already rolled the whole thing back, so the previous
      // snapshot and every log row are exactly where they were. The counters stay
      // put, so the next write tries again.
      console.error(
        JSON.stringify({ event: 'board-compaction-failed', error: errorMessage(error) }),
      );
      return false;
    }
  }

  /** Rows in `updates` (for tests and the room's diagnostics). */
  get logRows(): number {
    return this.logCount;
  }

  /** Un-compacted log rows and bytes, the numbers the compaction threshold reads. */
  pending(): PendingLog {
    return { count: this.logCount, bytes: this.logBytes };
  }

  /** Seq the stored snapshot covers, `0` when there is none. */
  snapshotThrough(): number {
    return this.metaNumber(META_SNAPSHOT_THROUGH);
  }

  /** Read one `storage_meta` value as a number, 0 when the key is absent. */
  private metaNumber(key: string): number {
    // Iterated rather than `one()`: `one()` throws when there is no row, and an
    // absent key is the normal case for a board that was never compacted.
    for (const row of this.run(`SELECT value FROM storage_meta WHERE key = ?1`, key)) {
      const value = row.value;
      const parsed = typeof value === 'string' ? Number(value) : Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  /** Stored log bytes. */
  get logSize(): number {
    return this.logBytes;
  }
}
