/**
 * One board's storage: an append-only log of Yjs updates plus a compacted snapshot, in the
 * board's own SQLite-backed Durable Object storage (story 4).
 *
 * The shape is deliberately boring:
 *
 * - `updates` is the log. Every change the room applies to its document is a row here
 *   before it reaches another screen, which is what makes "anything others have seen is
 *   saved" true without anyone pressing save.
 * - `snapshot_chunks` holds the board folded into one Yjs state, split so that no row is
 *   anywhere near the per-row size limit of SQLite-backed Durable Objects.
 * - `quarantined_updates` holds log rows that could not be read. A board with one broken
 *   change opens with every other change on it (PRD persist.partial_damage); the damaged
 *   row is kept there, with the error in its `reason` column, so it can be looked at.
 * - `storage_meta` holds `storage_schema_version` and `snapshot_through_seq`.
 *
 * The board document's own schema version (`meta.schemaVersion` in `board-model.ts`) is a
 * different thing and is unchanged by this story: `storage_schema_version` versions the
 * tables around it.
 *
 * Everything here is synchronous. The Durable Object SQL API is synchronous, and the room
 * depends on that: the row for a change is written in the same turn the change was applied,
 * and the runtime holds outgoing messages until pending writes are confirmed.
 *
 * ### Why the storage type is spelled out here
 *
 * `BoardStore` is written against the part of `DurableObjectStorage` it actually uses rather
 * than the ambient Workers type, so that the pure helpers (`chunkBytes`, `joinChunks`,
 * `shouldCompact`) can be unit-tested from the client project, which has the DOM types and
 * not the runtime ones. The real `DurableObjectStorage` satisfies it structurally.
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Origin for updates applied while loading a board: never stored, never broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** The value types a SQLite-backed Durable Object row can hold. */
export type SqlValue = ArrayBuffer | string | number | null;

/** The rows a query hands back, read one at a time or all at once. */
export interface SqlCursor<T extends Record<string, SqlValue>> {
  next(): { done?: false; value: T } | { done: true; value?: never };
  toArray(): T[];
  one(): T;
}

/** The SQL half of a Durable Object's storage. */
export interface SqlDriver {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: unknown[]): SqlCursor<T>;
}

/** The storage a `BoardStore` needs: SQL, and synchronous transactions. */
export interface BoardStorage {
  sql: SqlDriver;
  transactionSync<T>(closure: () => T): T;
}

/** What loading a board into a document produced. */
export type LoadResult =
  /** The board was read; `quarantined` log rows could not be and were set aside. */
  | { ok: true; quarantined: number }
  /**
   * The board could not be read. `snapshot-unreadable` means most of it is gone; `sql-error`
   * means the database itself refused. Either way the caller must not present the board as
   * empty - it shows "This board couldn't be loaded. Retrying…" instead.
   */
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Splits `data` into chunks of at most `size` bytes (nothing for empty input). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size < 1) throw new Error(`chunk size must be at least one byte, got ${size}`);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return chunks;
}

/** Puts the chunks back together, byte for byte. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** Whether a log of `count` rows and `bytes` total is worth folding into a snapshot. */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** A storage operation the tests ask to fail (one-shot; see `BoardStore.failNext`). */
export type BoardStoreFault =
  /** The next `append` throws as if the database refused the insert. */
  | 'append'
  /** The next `load` throws where it reads, so the room cannot serve the board. */
  | 'load'
  /** The next compaction throws before it begins. */
  | 'compaction'
  /**
   * The next compaction throws *inside* its transaction, after the old snapshot rows were
   * deleted: what a half-finished compaction must never do is lose a board.
   */
  | 'compaction-after-delete';

/** The key a snapshot's highest covered log row is remembered under. */
const SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

/** Test hook: bytes that are certainly not a Yjs update. */
const GARBAGE_BYTES = new Uint8Array([0xff, 0xff, 0xff, 0xff]);

/** A BLOB binding: a buffer holding exactly the bytes given, whatever buffer they view. */
function blob(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Whether a document is holding updates it could not place yet.
 *
 * Yjs parks an update whose bytes arrive with a hole in front of them - items from some author
 * that are later than something it has never seen - and waits for the missing piece. That is
 * normal, and it is also what a damaged row in the log leaves behind: the author's later changes
 * sit in `store.pendingStructs`, in memory, unreachable, waiting for bytes that only come back
 * if the damage is repaired or that author's tab reconnects and sends what it has.
 *
 * Both uses below are about not destroying that waiting state while trying to read the log.
 */
function isParkingBytes(doc: Y.Doc): boolean {
  const store = doc as unknown as { store?: { pendingStructs?: unknown } };
  return store.store?.pendingStructs != null;
}

/**
 * Stop a document waiting on bytes it will never be given, so the rows after them are read.
 *
 * This reaches into Yjs internals deliberately. Damaged bytes can leave a document parked on a
 * client that does not exist, and while it is parked on *anything* it refuses the later rows -
 * so quarantining a damaged row without clearing the parked bytes would cost every change that
 * came after it, which is the opposite of what a damaged row is supposed to cost. Nothing is
 * lost by clearing: the rows are still in the log, and `load` reads them again straight after.
 */
function abandonUnreadableBytes(doc: Y.Doc): void {
  const store = doc as unknown as { store?: { pendingStructs?: unknown; pendingDs?: unknown } };
  if (store.store) {
    store.store.pendingStructs = null;
    store.store.pendingDs = null;
  }
}

/** A short single-line description of an error, for the log and the quarantine table. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

/**
 * The storage of one board. One instance per room instance; it keeps the log's row count
 * and byte total in memory so that writing does not need a `COUNT(*)` per change.
 */
export class BoardStore {
  /**
   * Test seam: the next matching operation throws instead of touching SQLite. Production
   * code never sets it, and the room treats a throw exactly as a real database failure.
   */
  failNext: BoardStoreFault | null = null;

  /**
   * How many times this store has tried to read the board. A room that refuses to retry a failed
   * load too often is a rule worth being able to see, and the only way to see it is to count.
   */
  loadAttempts = 0;

  readonly #storage: BoardStorage;
  readonly #sql: SqlDriver;

  /** The log rows held above the snapshot, and their total size, both kept in memory. */
  #logCount = 0;
  #logBytes = 0;

  /** The highest log row the snapshot already contains (0 when there is no snapshot). */
  #snapshotThroughSeq = 0;
  /** Test hook state: the snapshot rows replaced by {@link corruptSnapshotForTest}. */
  #corrupted: ArrayBuffer[] | null = null;

  constructor(storage: BoardStorage) {
    this.#storage = storage;
    this.#sql = storage.sql;
  }

  /**
   * Creates the tables if they are missing and records the storage schema version.
   *
   * Opening a board writes nothing else: a board nobody has ever edited stays at zero rows
   * in every content table and opens as the empty board it is.
   */
  migrate(): void {
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (' +
        'seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
    );
    this.#sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (' +
        'seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    if (this.#meta('storage_schema_version') === null) {
      this.#setMeta('storage_schema_version', String(STORAGE_SCHEMA_VERSION));
    }
  }

  /**
   * Adds one update to the log, in a transaction of its own so the row and the counters mean
   * the same thing. Throws on a SQL failure: a room cannot keep serving a change it could not
   * write, so the caller resets the room rather than retrying here.
   */
  append(update: Uint8Array): void {
    this.#throwIfFaulted('append');
    const length = update.length;
    this.#storage.transactionSync(() => {
      this.#sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', blob(update), length);
    });
    this.#logCount += 1;
    this.#logBytes += length;
  }

  /** Whether the log has grown enough that folding it into a snapshot would be worth it. */
  compactionPending(): boolean {
    return shouldCompact(this.#logCount, this.#logBytes);
  }

  /**
   * Reads the board into `doc`: the snapshot first, then every log row newer than it, in
   * order. A row that will not apply is moved to `quarantined_updates` and counted, so one
   * damaged change costs that change and nothing else.
   *
   * Never throws, and never reports an unreadable board as an empty one: what the caller
   * needs to decide is in the returned `LoadResult`.
   */
  load(doc: Y.Doc): LoadResult {
    let snapshot: Uint8Array;
    let rows: { seq: number; data: ArrayBuffer }[];
    this.loadAttempts += 1;
    try {
      this.#throwIfFaulted('load');
      this.#snapshotThroughSeq = Number(this.#meta(SNAPSHOT_THROUGH_SEQ) ?? '0');
      snapshot = joinChunks(this.#readSnapshotChunks());
      rows = this.#sql
        .exec<{ seq: number; data: ArrayBuffer }>(
          'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
          this.#snapshotThroughSeq,
        )
        .toArray();
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describeError(error) };
    }

    if (snapshot.length > 0) {
      // A snapshot is most of the board. If it cannot be read, what is left is not the board,
      // so nothing is quarantined and nothing is deleted: the room refuses to serve it.
      try {
        Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
      } catch (error) {
        return { ok: false, reason: 'snapshot-unreadable', error: describeError(error) };
      }
    }

    // The log is read in one pass, and that is the fast path. A row that cannot be read costs
    // its own change: it is moved to the quarantine table and the log is read again over what
    // remains, because a document that has just thrown is parked on whatever the damaged bytes
    // looked like and will refuse the rows after them (see `abandonUnreadableBytes`). Reading a
    // row a document already has is a no-op in Yjs, so a second pass is wasted work and not a
    // risk - and what comes out is exactly the board the log gives with that one row left out,
    // which is what the tests hold it to.
    //
    // What is *not* recovered this way: an author's own changes after the damaged one. A hole in
    // one author's clock is a hole - Yjs will not place their later items until the missing one
    // arrives - so those rows stay parked in memory and stay in the log on disk, and they land
    // when that author's tab reconnects and sends what it has. Compaction refuses to fold a log
    // with bytes parked like that, so they are never quietly written out of existence.
    const abandoned = new Set<number>();
    let quarantined = 0;
    for (let pass = 0; ; pass += 1) {
      let damaged: { seq: number; data: ArrayBuffer; error: string } | null = null;
      for (const row of rows) {
        if (abandoned.has(row.seq)) continue;
        try {
          Y.applyUpdate(doc, new Uint8Array(row.data), LOAD_ORIGIN);
        } catch (error) {
          damaged = { seq: row.seq, data: row.data, error: describeError(error) };
          break;
        }
      }
      if (damaged === null || pass > rows.length) break;
      quarantined += 1;
      abandoned.add(damaged.seq);
      this.#quarantine(damaged.seq, damaged.data, damaged.error);
      console.error(
        JSON.stringify({
          event: 'board-update-quarantined',
          seq: damaged.seq,
          error: damaged.error,
        }),
      );
      abandonUnreadableBytes(doc);
    }

    if (quarantined > 0 && isParkingBytes(doc)) {
      console.error(
        JSON.stringify({
          event: 'board-log-incomplete',
          quarantined,
          note: 'later changes by the damaged author are held back until the missing change comes back',
        }),
      );
    }

    // From here on the room writes new rows, so the log's size is kept in memory rather than
    // counted per write. The rows just quarantined are out of the log, so what is measured is
    // exactly what the next wake-up will have to replay.
    this.#remeasureLog();
    return { ok: true, quarantined };
  }

  /**
   * Folds the log into a new snapshot once it has grown past a threshold, so that waking a
   * board never means replaying its whole history.
   *
   * The new snapshot rows, the deleted log rows and the new `snapshot_through_seq` are one
   * transaction: if any statement fails, the old snapshot and the whole log survive and this
   * returns `false`. It never throws - a board that cannot be compacted yet is still a board.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.#logCount, this.#logBytes)) return false;
    // A log the document is still parking on must not be folded: the snapshot is written from
    // what the document holds, so folding now would write the parked rows out of existence while
    // claiming, in `snapshot_through_seq`, that they were included.
    if (isParkingBytes(doc)) return false;
    try {
      this.#throwIfFaulted('compaction');
      const chunks = chunkBytes(Y.encodeStateAsUpdate(doc));
      let throughSeq = 0;
      this.#storage.transactionSync(() => {
        throughSeq = this.#maxLogSeq();
        this.#sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, index) => {
          this.#sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index, blob(chunk));
        });
        // An injected failure lands here on purpose: everything above and below this point is
        // the same transaction, so a compaction cannot half-happen.
        this.#throwIfFaulted('compaction-after-delete');
        this.#sql.exec('DELETE FROM updates WHERE seq <= ?', throughSeq);
        this.#setMeta(SNAPSHOT_THROUGH_SEQ, String(throughSeq));
      });
      this.#snapshotThroughSeq = throughSeq;
      this.#logCount = 0;
      this.#logBytes = 0;
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'board-compaction-failed', error: describeError(error) }),
      );
      return false;
    }
  }

  /**
   * Test hook: replaces the folded snapshot with bytes that are not a Yjs update, and keeps what
   * was there so {@link repairSnapshotForTest} can put it back.
   *
   * Only reachable through `/__test/boards/:id/corrupt-snapshot`, which the Worker answers when
   * `TEST_HOOKS=1` - set by the e2e dev servers, never by production config. The rows are replaced
   * rather than deleted because that is the failure a board cannot be opened on: a snapshot that
   * exists and will not apply. (A damaged *log* row only costs itself, which TC-09 covers.)
   *
   * The originals are held in memory, which is enough for the one test that uses them - and means a
   * hook left switched on somewhere cannot quietly lose a board's snapshot for good.
   */
  corruptSnapshotForTest(): { chunks: number } {
    const chunks = this.#readSnapshotChunks();
    if (chunks.length === 0) {
      throw new Error('this board has no snapshot, so nothing here can make it unreadable as a whole');
    }
    this.#corrupted = chunks.map((chunk) => blob(chunk));
    for (let index = 0; index < chunks.length; index += 1) {
      this.#sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = ?',
        blob(GARBAGE_BYTES),
        index,
      );
    }
    return { chunks: chunks.length };
  }

  /** Test hook: writes the snapshot back exactly as {@link corruptSnapshotForTest} found it. */
  repairSnapshotForTest(): { chunks: number } {
    if (this.#corrupted === null) {
      throw new Error('this storage was not corrupted by the hook, so there is nothing to restore');
    }
    const saved = this.#corrupted;
    saved.forEach((data, index) => {
      this.#sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', blob(new Uint8Array(data)), index);
    });
    this.#corrupted = null;
    return { chunks: saved.length };
  }

  /** The snapshot's rows, in order, oldest first. Throws if the database refuses. */
  #readSnapshotChunks(): Uint8Array[] {
    return this.#sql
      .exec<{ idx: number; data: ArrayBuffer }>('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
      .toArray()
      .map((row) => new Uint8Array(row.data));
  }

  /** The highest log row, or 0 when the log is empty. */
  #maxLogSeq(): number {
    const row = this.#sql
      .exec<{ seq: number }>('SELECT COALESCE(MAX(seq), 0) AS seq FROM updates')
      .one();
    return row.seq;
  }

  /**
   * Re-measures the log after a load, so the in-memory size the compaction threshold works on
   * matches the rows. Best effort: if this query fails the thresholds are simply a little off,
   * and the next load fixes them - a board must still open.
   */
  #remeasureLog(): void {
    try {
      const row = this.#sql
        .exec<{ rows: number; total: number }>(
          'SELECT COUNT(*) AS rows, COALESCE(SUM(bytes), 0) AS total FROM updates WHERE seq > ?',
          this.#snapshotThroughSeq,
        )
        .one();
      this.#logCount = row.rows;
      this.#logBytes = row.total;
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'board-log-measure-failed', error: describeError(error) }),
      );
    }
  }

  /** Moves a row that could not be applied out of the log and into the quarantine table. */
  #quarantine(seq: number, data: ArrayBuffer, error: string): void {
    try {
      this.#storage.transactionSync(() => {
        this.#sql.exec(
          'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          data,
          error,
          Date.now(),
        );
        this.#sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      });
    } catch (quarantineError) {
      // The row stays in the log: the next load will trip over it and say so again.
      console.error(
        JSON.stringify({
          event: 'board-quarantine-failed',
          seq,
          error: describeError(quarantineError),
        }),
      );
    }
  }

  #meta(key: string): string | null {
    const rows = this.#sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', key)
      .toArray();
    return rows.length > 0 ? (rows[0]?.value ?? null) : null;
  }

  #setMeta(key: string, value: string): void {
    this.#sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  /** Consumes a one-shot injected failure, if one is set for this operation. */
  #throwIfFaulted(operation: BoardStoreFault): void {
    if (this.failNext !== operation) return;
    this.failNext = null;
    throw new Error(`injected storage failure during ${operation}`);
  }
}
