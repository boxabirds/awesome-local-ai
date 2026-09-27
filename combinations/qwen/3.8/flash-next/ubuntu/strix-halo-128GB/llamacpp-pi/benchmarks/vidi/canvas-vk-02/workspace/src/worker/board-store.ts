/**
 * `persist.board_store` — everything one board keeps on disk (story 4).
 *
 * One SQLite database per board room, three tables of content and one of
 * bookkeeping (design "Storage schema"):
 *
 * - `updates` is the log: every Yjs update the board has accepted, oldest
 *   first. Appending is the only write on the hot path, and it is a single
 *   `INSERT`, so saving a change costs nothing proportional to the board.
 * - `snapshot_chunks` is the compacted board: `Y.encodeStateAsUpdate` of the
 *   whole document, cut into rows of `SNAPSHOT_CHUNK_BYTES` so no row
 *   approaches the per-row size limit of SQLite-backed Durable Objects.
 * - `quarantined_updates` holds log rows that Yjs refuses to read again, each
 *   with the error it produced. A damaged row is removed from the replay and
 *   the rest of the board loads — losing one change, not the board
 *   (`persist.partial_damage`).
 * - `storage_meta` carries `storage_schema_version` (the tables) and
 *   `snapshot_through_seq` (which log rows the snapshot already contains).
 *
 * Loading replays the snapshot, then every log row above `snapshot_through_seq`
 * in order. A snapshot that cannot be read is fatal, and deliberately so: half
 * a board presented as a whole one is the silent data loss this story exists to
 * prevent, so the caller is told `ok: false` and nothing is deleted or
 * quarantined. A damaged *log row* is not fatal.
 *
 * Compaction folds the log into a new snapshot inside one `transactionSync`,
 * so a failure at any point — including between deleting the old chunks and
 * writing the new ones — leaves the previous snapshot and the whole log intact.
 *
 * Row counts and byte totals are tracked in memory after a load: the room asks
 * "is it time to compact?" on every change, and that must not cost a `COUNT(*)`.
 */

import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Origin of every update applied while loading a board. The room leaves
 * transactions from this origin alone: they are already in storage, and
 * rebroadcasting the board to whoever just asked for it would be an echo.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/** What one load attempt ended with. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * What is recorded against a row the board cannot show: the bytes are kept, but
 * the update they hold depends on content that has gone.
 */
const UNREACHABLE = 'update could not be applied: it depends on content that is no longer readable';

const META_TABLE = 'storage_meta';
const META_SCHEMA_VERSION = 'storage_schema_version';
const META_THROUGH_SEQ = 'snapshot_through_seq';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
] as const;

/**
 * Cut `data` into chunks of at most `size` bytes: `ceil(size / chunk)`, so an
 * empty input is no chunks and a single byte is exactly one.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${String(size)}`);
  }
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.byteLength; start += size) {
    chunks.push(data.subarray(start, Math.min(start + size, data.byteLength)));
  }
  return chunks;
}

/** The concatenation of `chunks`, in order. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}

/** Is the log worth folding into a snapshot? Either threshold is enough. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** A human-readable form of whatever SQLite or Yjs threw. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Do two encoded state vectors name the same document state? */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/** SQLite binds blobs as `ArrayBuffer`; a `Uint8Array` view is not accepted. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

interface LogTotalsRow {
  count: number;
  bytes: number;
  maxSeq: number;
}

interface UpdateRow {
  seq: number;
  data: ArrayBuffer;
}

interface MetaRow {
  key: string;
  value: string;
}

export class BoardStore {
  readonly #storage: DurableObjectStorage;

  /** Rows currently in `updates`, their total bytes and the highest `seq` ever used. */
  #logCount = 0;
  #logBytes = 0;
  #maxSeq = 0;

  /** Highest `seq` the snapshot already contains; the log replay starts above it. */
  #throughSeq = 0;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
  }

  /** `snapshot_through_seq`: the log rows the current snapshot subsumes. */
  get snapshotThroughSeq(): number {
    return this.#throughSeq;
  }

  /** The log's current size, which is what decides when to compact. */
  logSize(): { count: number; bytes: number } {
    return { count: this.#logCount, bytes: this.#logBytes };
  }

  /**
   * Create the tables if they are not there and record the storage schema
   * version. Creating a board is idempotent and writes no update rows: a board
   * that was merely opened, never edited, stays a board with nothing stored.
   */
  migrate(): void {
    const sql = this.#storage.sql;
    for (const statement of SCHEMA_STATEMENTS) sql.exec(statement);
    sql.exec(
      `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
    this.#readThroughSeq();
  }

  /**
   * Add one update to the log. SQL errors are rethrown: the caller is the room,
   * and a change that cannot be written must not be broadcast (`persist.save_failure`).
   */
  append(update: Uint8Array): void {
    const seq = this.#maxSeq + 1;
    this.#storage.sql.exec(
      'INSERT INTO updates (seq, data, bytes) VALUES (?, ?, ?)',
      seq,
      asArrayBuffer(update),
      update.byteLength,
    );
    this.#maxSeq = seq;
    this.#logCount += 1;
    this.#logBytes += update.byteLength;
  }

  /**
   * Fill `doc` with everything the board has stored: the snapshot, then the log
   * rows above it, oldest first.
   *
   * A row that cannot be read is moved to `quarantined_updates` with the error it
   * produced, and the board opens with what came before it — `persist.partial_damage`
   * wants the board to open, not to fail. How far "what came before" reaches is
   * decided by two properties of Yjs, both measured in
   * `tests/integration/board-store.test.ts` rather than assumed:
   *
   * - A document that is handed bytes it throws on stops accepting *any* later
   *   update, without saying so. So every row is decoded into the update format
   *   before it touches a document, and a row that does not decode never gets near
   *   one. The replay also happens on a document of its own, whose encoded state is
   *   the only thing applied to `doc`.
   * - Yjs updates form a dependency graph: an update whose dependencies are
   *   missing is queued, and a queued update leaves a hole behind — later rows that
   *   only wait for the queue still tombstone content that is already visible. So
   *   the replay stops at the first row that does not become part of the document
   *   (state vector unmoved), and everything from that row on is quarantined as
   *   unreachable. Continuing past the gap is what turns "one change is damaged"
   *   into "the board is subtly wrong", which is the failure this whole story
   *   exists to prevent; stopping keeps the loaded board byte-for-byte identical to
   *   the same board loaded from a log whose damaged tail was never written.
   *
   * Nothing is ever deleted from storage on the way: every row that could not be
   * used is kept, with its reason, in `quarantined_updates`. And the document that
   * is served is built by a replay of the rows known to belong, never by the one
   * that met the damage.
   */
  load(doc: Y.Doc): LoadResult {
    let quarantined = 0;
    try {
      this.migrate();

      const snapshot = this.#readSnapshot();
      // The rows that have become part of the board, kept so the replay can be
      // done again without them after one is refused (see below).
      const accepted: Uint8Array[] = [];
      let scratch: Y.Doc;
      try {
        scratch = this.#scratch(snapshot);
      } catch (error) {
        // Half a board is not a board: nothing is quarantined, nothing is
        // deleted, and the caller refuses to serve an empty document.
        return { ok: false, reason: 'snapshot-unreadable', error: describeError(error) };
      }

      const rows = this.#storage.sql
        .exec<UpdateRow>('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq ASC', this.#throughSeq)
        .toArray();

      for (let at = 0; at < rows.length; at++) {
        const row = rows[at] as UpdateRow;
        const unusable = this.#readRow(scratch, new Uint8Array(row.data));
        if (unusable === null) {
          accepted.push(new Uint8Array(row.data));
          continue;
        }
        this.#quarantine(row.seq, row.data, unusable);
        quarantined += 1;
        // Everything after the first row that cannot be placed is unreachable
        // too. It is quarantined with its own reason rather than silently
        // skipped, so what the board contains and what storage holds are the
        // same story.
        for (const rest of rows.slice(at + 1)) {
          this.#quarantine(rest.seq, rest.data, UNREACHABLE);
          quarantined += 1;
        }
        // A row that was refused may have left a mark on the document it was
        // refused by: an update that cannot be placed is queued, and a queued
        // update can tombstone content that is already visible without moving
        // the state vector at all. `tests/unit/yjs-damage-semantics.test.ts`
        // measures it. So the board is replayed once more from the rows that are
        // known to belong, and that is what gets served.
        scratch = this.#scratch(snapshot);
        for (const update of accepted) Y.applyUpdate(scratch, update);
        break;
      }

      Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch), LOAD_ORIGIN);
      this.#recount();
      if (quarantined > 0) {
        console.error(JSON.stringify({ event: 'board-store.quarantined-updates', quarantined }));
      }
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describeError(error) };
    }
  }

  /** A document holding the snapshot and nothing else; the base of a replay. */
  #scratch(snapshot: Uint8Array | null): Y.Doc {
    const doc = new Y.Doc();
    if (snapshot !== null) Y.applyUpdate(doc, snapshot);
    return doc;
  }

  /**
   * Apply one log row to the replay document, or say why it cannot be applied.
   * `null` means the row is now part of `scratch`.
   */
  #readRow(scratch: Y.Doc, bytes: Uint8Array): string | null {
    try {
      // Decode before applying: reading the whole update is what the parser
      // refuses when the bytes are damaged, and this keeps the document out of
      // reach of a partial read.
      Y.decodeUpdate(bytes);
    } catch (error) {
      return describeError(error);
    }
    try {
      const before = Y.encodeStateVector(scratch);
      Y.applyUpdate(scratch, bytes);
      return sameBytes(before, Y.encodeStateVector(scratch)) ? UNREACHABLE : null;
    } catch (error) {
      return describeError(error);
    }
  }

  /**
   * Fold the log into the snapshot when it has grown past either threshold.
   *
   * `doc` is the live document, which already holds the snapshot plus the log,
   * so its encoded state is the whole board. One `transactionSync` replaces the
   * chunks, drops the rows the snapshot now covers and moves `snapshot_through_seq`
   * on; anything thrown inside rolls the whole thing back, leaving a readable
   * board and a log that will be compacted again later.
   *
   * Never throws: a compaction that fails is an efficiency loss, not a data loss.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.#logCount, this.#logBytes)) return false;
    const throughSeq = this.#maxSeq;

    let encoded: Uint8Array;
    try {
      encoded = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'board-store.compaction-failed', stage: 'encode', error: describeError(error) }),
      );
      return false;
    }

    const chunks = chunkBytes(encoded);
    try {
      this.#storage.transactionSync(() => {
        const sql = this.#storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, asArrayBuffer(chunk));
        });
        sql.exec('DELETE FROM updates WHERE seq <= ?', throughSeq);
        sql.exec(
          `INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          META_THROUGH_SEQ,
          String(throughSeq),
        );
      });
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'board-store.compaction-failed', stage: 'transaction', error: describeError(error) }),
      );
      return false;
    }

    this.#throughSeq = throughSeq;
    this.#recount();
    return true;
  }

  // -----------------------------------------------------------------------

  #readSnapshot(): Uint8Array | null {
    const chunks = this.#storage.sql
      .exec<{ idx: number; data: ArrayBuffer }>('SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC')
      .toArray();
    if (chunks.length === 0) return null;
    return joinChunks(chunks.map((row) => new Uint8Array(row.data)));
  }

  #readThroughSeq(): void {
    const row = this.#storage.sql
      .exec<MetaRow>(`SELECT key, value FROM ${META_TABLE} WHERE key = ?`, META_THROUGH_SEQ)
      .toArray()[0];
    const parsed = row === undefined ? Number.NaN : Number.parseInt(row.value, 10);
    this.#throughSeq = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  /** Refresh the in-memory log totals from the table, after a load or compaction. */
  #recount(): void {
    const totals = this.#storage.sql
      .exec<LogTotalsRow>(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(MAX(seq), 0) AS maxSeq FROM updates',
      )
      .one();
    this.#logCount = totals.count;
    this.#logBytes = totals.bytes;
    // A compacted log is empty while the snapshot remembers higher sequence
    // numbers; the next row appended has to come after them, not reuse them.
    this.#maxSeq = Math.max(totals.maxSeq, this.#throughSeq);
  }

  /** Move one unreadable log row out of the replay, keeping it for diagnosis. */
  #quarantine(seq: number, data: ArrayBuffer, error: string): void {
    this.#storage.transactionSync(() => {
      const sql = this.#storage.sql;
      sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
      sql.exec('DELETE FROM updates WHERE seq = ?', seq);
    });
    this.#logCount = Math.max(0, this.#logCount - 1);
    this.#maxSeq = Math.max(this.#maxSeq, seq);
  }
}
