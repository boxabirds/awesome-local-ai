import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * A board's whole persistence: an append-only log of the Yjs updates the room
 * accepted, plus a snapshot of the whole document that lets that log be
 * truncated. It lives in this board's Durable Object SQLite storage — the board
 * is the Durable Object, so it has one storage and no global database, no
 * foreign keys, no migration of anyone else's data.
 *
 * Every method is synchronous, because `DurableObjectStorage.sql` is: a write
 * that has returned before the room broadcasts is the mechanism by which an
 * update the room could not store is never broadcast (PRD persist.save_failure).
 *
 * @see spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/design.md
 */

/** The origin every update loaded *out of* storage is applied under. The room
 * skips storing updates whose origin is this, so loading a board can never
 * write the board back to itself. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/** Why a board could not be loaded. Both mean: never present it as empty. */
export type LoadFailureReason = 'snapshot-unreadable' | 'sql-error';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: LoadFailureReason; error: string };

/**
 * Test-only seam, called with each SQL statement before it runs so a test can
 * make one of them throw. It sits *outside* SQLite, so a throw inside a
 * `transactionSync` still rolls the transaction back the way a real failure
 * would (TC-11). Production passes nothing.
 */
export interface StorageFaults {
  beforeStatement(statement: string): void;
}

/** A value SQLite accepts as a column value. */
export type SqlValue =
  | ArrayBuffer
  | ArrayBufferView
  | string
  | number
  | boolean
  | null;

/** One row, as the columns come back from SQLite. */
export type SqlRow = Record<string, unknown>;

/**
 * The part of `DurableObjectStorage` this store uses, declared structurally
 * rather than as the `DurableObjectStorage` global: the chunking helpers next to
 * it are unit-tested in the plain-node project, which type-checks without the
 * Workers globals (tsconfig.json excludes src/worker from the Workers-typed
 * project). `ctx.storage` satisfies this shape as it is.
 */
export interface BoardStorage {
  readonly sql: {
    exec(query: string, ...values: SqlValue[]): { toArray(): SqlRow[] };
  };
  transactionSync<T>(fn: () => T): T;
}

/** The storage_meta key holding the seq the snapshot already contains. */
export const THROUGH_SEQ_KEY = 'snapshot_through_seq';

/** The storage_meta key holding the storage schema version. */
export const SCHEMA_VERSION_KEY = 'storage_schema_version';

/**
 * Test-only: the storage_meta key into which the story 4 corruption hook moves
 * snapshot chunk 0 so the repair hook can put it back. A production board never
 * has this row: only the hook writes it.
 */
export const TEST_CHUNK_BACKUP_KEY = 'test_snapshot_chunk_0_backup';

/**
 * Split `data` into chunks of at most `size` bytes. Zero bytes is zero chunks,
 * and no chunk is ever empty: the snapshot of a 2000-note board is 200-400 KB,
 * close enough to the per-row size limit of Durable Object SQLite that storing
 * it as one row would be a board that cannot grow.
 */
export function chunkBytes(
  data: Uint8Array,
  size: number = SNAPSHOT_CHUNK_BYTES,
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** The inverse of {@link chunkBytes}: the chunks back into one byte array. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Whether the update log has grown past either compaction threshold. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * A copy of `bytes` as an owned ArrayBuffer. SQLite takes a Blob for the update
 * bytes; handing it a view into a larger buffer (a `Buffer`, or a `subarray` of
 * a decoded frame) would store the whole buffer.
 */
const asBlob = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

/** Read a storage_meta value as a number, or `fallback` when the row is absent. */
const metaNumber = (storage: BoardStorage, key: string): number | null => {
  const rows = storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray();
  if (rows.length === 0) return null;
  const value = rows[0]!['value'];
  return typeof value === 'number' ? value : Number(value);
};

export class BoardStore {
  private readonly storage: BoardStorage;
  private readonly faults: StorageFaults | undefined;

  /** Rows above the snapshot and their total bytes, tracked in memory so a
   * write costs no COUNT(*). Re-derived from storage by {@link load}. */
  private logCount = 0;
  private logBytes = 0;
  /** The highest `seq` this store has seen in the updates log. */
  private maxSeq = 0;
  /** The highest seq the current snapshot already contains. */
  private throughSeq = 0;

  constructor(storage: BoardStorage, faults?: StorageFaults) {
    this.storage = storage;
    this.faults = faults;
  }

  /** Run one statement, giving a test the chance to make it throw first. */
  private exec(query: string, ...values: SqlValue[]): SqlRow[] {
    this.faults?.beforeStatement(query);
    return this.storage.sql.exec(query, ...values).toArray();
  }

  /** How many log rows sit above the snapshot (for tests and logging). */
  get pendingCount(): number {
    return this.logCount;
  }

  /**
   * Whether the log has passed a compaction threshold. The room asks this before
   * it tells its state machine that compaction is due, so the state machine is
   * never told about a compaction that was not going to run.
   */
  get compactionDue(): boolean {
    return shouldCompact(this.logCount, this.logBytes);
  }

  /** The seq the snapshot contains (0 for a board never compacted). */
  get snapshotThroughSeq(): number {
    return this.throughSeq;
  }

  /**
   * Create the tables if they do not exist, and record the storage schema
   * version when it is absent. A no-op on an up-to-date board: there are no
   * columns to add because a DO's SQLite storage has no `ALTER TABLE ADD
   * COLUMN`, and this story's schema is the first one ever created here.
   */
  migrate(): void {
    this.exec(
      `CREATE TABLE IF NOT EXISTS updates (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         data BLOB NOT NULL,
         bytes INTEGER NOT NULL
       )`,
    );
    this.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (
         idx INTEGER PRIMARY KEY,
         data BLOB NOT NULL
       )`,
    );
    this.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (
         seq INTEGER PRIMARY KEY,
         data BLOB NOT NULL,
         error TEXT NOT NULL,
         quarantined_at INTEGER NOT NULL
       )`,
    );
    this.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
    );
    const version = metaNumber(this.storage, SCHEMA_VERSION_KEY);
    if (version === null) {
      this.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        SCHEMA_VERSION_KEY,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /**
   * Store one applied update. Throws on SQL failure — and the caller must not
   * broadcast an update this method threw for (PRD persist.save_failure).
   */
  append(update: Uint8Array): void {
    this.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      asBlob(update),
      update.byteLength,
    );
    // This board's storage has one writer, this room, so the highest seq in the
    // log is the row just written. Reading it back with MAX(seq) keeps the
    // in-memory counters honest without a COUNT(*) over the update bodies.
    const row = this.exec('SELECT MAX(seq) AS seq FROM updates')[0];
    const seq = Number(row?.['seq']);
    if (Number.isFinite(seq) && seq > this.maxSeq) this.maxSeq = seq;
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  /**
   * Apply the snapshot, then the log rows above it in seq order, to `doc`.
   *
   * A row that no longer decodes is *quarantined*: moved to
   * `quarantined_updates` with the error, in one transaction, and the load goes
   * on with the rest (PRD persist.corrupt_update). What that keeps is the
   * readable part of the board: a damaged row in the middle of a log also costs
   * the later rows that depended on what it created, because Yjs holds those
   * pending rather than inventing content — the board comes back smaller, never
   * empty, and never as a board that was written over. A snapshot that does not
   * decode is a board that cannot be loaded — reported, never presented empty.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      this.throughSeq = metaNumber(this.storage, THROUGH_SEQ_KEY) ?? 0;

      const chunkRows = this.exec(
        'SELECT data FROM snapshot_chunks ORDER BY idx',
      );
      if (chunkRows.length > 0) {
        const snapshot = joinChunks(
          chunkRows.map((row) => new Uint8Array(row['data'] as ArrayBuffer)),
        );
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          // TC-10: the board's content is *there* and unreadable. Returning ok
          // here would show an empty board and let people write over it.
          console.error(
            '[vidi6] snapshot could not be read; board not presented as empty',
            { reason: 'snapshot-unreadable', error: String(error) },
          );
          return { ok: false, reason: 'snapshot-unreadable', error: String(error) };
        }
      }

      const rows = this.exec(
        'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
        this.throughSeq,
      );
      let applied = 0;
      let bytes = 0;
      let quarantined = 0;
      let maxSeq = this.throughSeq;
      for (const row of rows) {
        const seq = Number(row['seq']);
        maxSeq = seq;
        const data = new Uint8Array(row['data'] as ArrayBuffer);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          applied += 1;
          bytes += data.byteLength;
        } catch (error) {
          this.quarantine(seq, data, String(error));
          quarantined += 1;
          console.error('[vidi6] update quarantined while loading board', {
            seq,
            error: String(error),
          });
        }
      }
      this.maxSeq = maxSeq;
      this.logCount = applied;
      this.logBytes = bytes;
      return { ok: true, quarantined };
    } catch (error) {
      // A storage read that itself failed: the board is not empty either.
      console.error('[vidi6] board storage could not be read', {
        reason: 'sql-error',
        error: String(error),
      });
      return { ok: false, reason: 'sql-error', error: String(error) };
    }
  }

  /**
   * Compact when the log has passed a threshold. Returns false when it was not
   * due, and false when the compaction failed — in which case the transaction
   * rolled back and the log is intact (TC-11).
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;
    return this.compact(doc);
  }

  /**
   * Replace the snapshot with the document as it is now, then truncate the log,
   * in one transaction: a board is never left with a snapshot that is missing
   * updates the log no longer holds. Everything else about the board is
   * unchanged — the same encoded state goes back over a rejoining client's
   * WebSocket whichever way the bytes are laid out.
   *
   * Only {@link compactIfNeeded} runs this in production; the unconditional form
   * exists so the story 4 fixtures can compact a small board before corrupting
   * its snapshot.
   */
  compact(doc: Y.Doc): boolean {
    const snapshot = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(snapshot);
    const through = this.maxSeq;
    try {
      this.storage.transactionSync(() => {
        this.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          this.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
            idx,
            asBlob(chunk),
          );
        });
        this.exec('DELETE FROM updates WHERE seq <= ?', through);
        this.exec(
          `INSERT INTO storage_meta (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          THROUGH_SEQ_KEY,
          String(through),
        );
      });
    } catch (error) {
      // The transaction rolled back: the previous snapshot chunks and the whole
      // log are still there, so the board is still loadable and saves again.
      console.error('[vidi6] compaction failed, rolled back; log intact', {
        error: String(error),
      });
      return false;
    }
    this.throughSeq = through;
    this.logCount = 0;
    this.logBytes = 0;
    return true;
  }

  /**
   * Move one log row to `quarantined_updates` with the error, in one transaction:
   * a row cannot be lost by a crash between the delete and the insert.
   */
  private quarantine(seq: number, data: Uint8Array, message: string): void {
    this.storage.transactionSync(() => {
      this.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.exec(
        `INSERT INTO quarantined_updates (seq, data, error, quarantined_at)
         VALUES (?, ?, ?, ?)`,
        seq,
        asBlob(data),
        message,
        Date.now(),
      );
    });
  }
}
