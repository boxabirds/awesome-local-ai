/**
 * The board's own storage: what a board is when nobody is looking at it.
 *
 * A board is stored as it happens, in two parts. Every change that was applied goes into
 * `updates` as the Yjs update bytes it arrived as — nothing is ever rewritten, so a change
 * the room accepted is on disk before anybody is told about it. Once that log gets long it
 * is folded into a snapshot of the whole board in `snapshot_chunks`, and only the changes
 * since the snapshot stay in the log. A board is therefore always "a snapshot plus a short
 * list of changes", which is what bounds how long it takes to read a board back however
 * long it has been in use: `snapshot_through_seq` says where the snapshot stops and the
 * log starts.
 *
 * Reading is deliberately conservative, because the alternative is telling somebody their
 * board is empty when it is not:
 *
 * - one damaged row in the log is moved to `quarantined_updates` with the error that moved
 *   it, and the rest of the board loads (`ok: true` with a count). A note that will not
 *   read is that note's problem, and its bytes are kept so the answer to "the room forgot
 *   my note" is not "it did, and we threw the note away";
 * - a snapshot that will not read stops the load (`ok: false`). It is *not* quarantined: a
 *   snapshot is most of the board, so loading "everything except the part I could not read"
 *   would show a board missing all its old notes and call that the board. The rows are left
 *   exactly where they are, and while this store holds an unreadable snapshot it refuses to
 *   compact, because compaction is the only write that empties the log;
 * - a compaction that goes wrong rolls back, leaving the old snapshot and the whole log.
 *   That is why a board that could not be folded is still a board, and why nobody has to be
 *   told about it.
 *
 * Everything here is synchronous on purpose. `storage.sql` and `storage.transactionSync`
 * are, which is what lets the room write a change, know it is durable, and only then repeat
 * it to anybody else.
 */
import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';
import { initDoc } from '../shared/board-model';

/**
 * The origin a board is loaded under.
 *
 * The room is a Yjs peer as well as a store, so what it reads back arrives in its own
 * document as an update like any other. Marking it with this symbol is what tells the room
 * "this is the board you just read from disk", so it is neither written back to storage nor
 * sent to the people who are already looking at it.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/** Where `corruptSnapshot` keeps the bytes it damaged, so that a test can put them back. */
const SAVED_CHUNK = 'test_snapshot_chunk_saved';

/** The row that says this board's reads are failing. Only a test writes it. */
const POISONED = 'test_read_failure';

/** What reading a board out of storage turned out to be. */
export type LoadResult =
  /** The board was read; `quarantined` log rows could not be, and are logged. */
  | { ok: true; quarantined: number }
  /** The board was not read. Nothing was written or deleted while trying. */
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** How much log there is: rows, and the bytes in them. */
export interface LogCounters {
  updates: number;
  bytes: number;
}

/** What a board's tables hold, for the test hooks and for anybody who has to debug a board. */
export interface BoardStats extends LogCounters {
  snapshot: { throughSeq: number; chunks: number; bytes: number; unreadable: boolean };
  quarantined: { count: number; bytes: number };
  storageSchemaVersion: number;
  /** Writes this store tried to make and could not. */
  storageFailures: number;
}

/** Something the room wants written down about its board. */
export type Logger = (line: string) => void;

/** An operation a test can ask to be made to fail. */
export type StoreOperation = 'append' | 'compaction' | 'load' | 'read';

/** One row from `storage.sql`, whose columns are whatever the query asked for. */
type SqlRow = Record<string, unknown>;

/** The rows a query hands back: something to walk once. */
type SqlRows = Iterable<SqlRow>;

/** `storage.sql`, as far as this file cares. */
interface SqlExecutor {
  exec(query: string, ...bindings: unknown[]): SqlRows & { columnNames?: string[] };
}

function firstRow<T extends SqlRow>(rows: SqlRows): T | undefined {
  for (const row of rows) return row as T;
  return undefined;
}

/** SQLite hands a BLOB back as an ArrayBuffer; Yjs wants a view over it. */
function asBytes(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The part of a document Yjs parked because it never received what it refers to, or `null`.
 *
 * `store.pendingStructs` is not public API and is treated as nothing more than a yes-or-no here:
 * it is the only way to see the failure that Yjs does not report, and this is the only place in
 * this file that looks at it. If a future version renames it, `parkedIn` stops seeing parking —
 * which would make a damaged row quietly lose the notes after it again, and the test that damages
 * a row (TC-09) is the thing that would notice.
 */
function parkedIn(board: Y.Doc): string | null {
  const pending = (board.store as unknown as { pendingStructs?: unknown }).pendingStructs;
  return pending === null || pending === undefined ? null : 'this update refers to changes the board does not have';
}

/**
 * Forget what was parked, because its row has just been moved out of the log.
 *
 * The parked bytes came from a row this store has decided it cannot use; leaving them in the
 * document would make the next row look parked as well, and one damaged row would be reported as
 * the whole tail of the log.
 */
function clearParkedIn(board: Y.Doc): void {
  (board.store as unknown as { pendingStructs: unknown }).pendingStructs = null;
}

/**
 * Cut `data` into pieces no longer than `size`.
 *
 * A snapshot is one Yjs update, so it cannot be split into meaningful parts — but it can be
 * split into *rows*, and a board that grows must not grow a single row past what the
 * storage engine is willing to hold. The pieces are copies, so a chunk keeps its bytes
 * whether or not the buffer it was cut from goes on being used.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.byteLength; start += size) {
    chunks.push(data.slice(start, Math.min(start + size, data.byteLength)));
  }
  return chunks;
}

/** Put the pieces back, in order. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const data = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  return data;
}

/**
 * Whether this much log is enough log: at this count, or at this many bytes.
 *
 * Both halves are counted because neither is enough on its own. Five hundred edits to one
 * character is a log that is short in bytes and slow to read back; twenty huge pastes is a
 * log nobody would call long by count. Either is reason enough to fold it away.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * One board's tables, made with its room and living as long as the room does.
 *
 * The tables outlive the room, which is the entire reason this file exists.
 */
/** Bytes as text, because the metadata table holds text and a test needs its damage put back. */
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** The other half of `toBase64`. */
function fromBase64(text: string): Uint8Array {
  const decoded = atob(text);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}


export class BoardStore {
  /** Log rows read at a time, so a board used for a year is not one enormous read. */
  private static readonly READ_BATCH = 200;

  /** Everything that has been said about this board, oldest first. */
  readonly lines: string[] = [];

  /** Writes that were tried and could not be made, oldest first. */
  readonly failures: { operation: StoreOperation; error: string }[] = [];

  /** The last row of the log the snapshot already contains; 0 when there is no snapshot. */
  private throughSeq = 0;

  /** How much log is in the tables, remembered rather than re-counted on every write. */
  private counters: LogCounters = { updates: 0, bytes: 0 };

  /** The reason this board would not load, while this store still knows it. */
  private damage: string | null = null;

  /** Set while this store is inside one of its own operations, so a failure can be aimed. */
  private inside: StoreOperation | null = null;

  /** A failure to raise inside an operation, and how many of its statements to pass first. */
  private armed: { operation: StoreOperation; through: number } | null = null;

  /**
   * A read failure that is written in the board's own storage. `armed` is a wish held by this
   * object and disappears with it; some failures have to be a property of the storage instead,
   * because that is what they are: a board that cannot be read is not readable again by the
   * object being rebuilt.
   */
  private poisoned: StoreOperation | null = null;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly log: Logger = () => {},
  ) {
    this.putFailuresInFrontOfStorage();
  }

  // --- the tables -----------------------------------------------------------

  /**
   * The board's tables, if they are not there yet, and the schema they are at.
   *
   * `CREATE TABLE IF NOT EXISTS` runs on every wake because it is idempotent, cheap, and
   * the alternative is knowing which of the ways a room comes into existence has already
   * done it. It writes no rows of its own: opening a board nobody has ever edited creates
   * tables and nothing else.
   *
   *   storage_meta             one or two rows: `storage_schema_version`, and
   *                            `snapshot_through_seq` — the last log row the snapshot
   *                            already contains, which is where a load starts reading
   *                            the log.
   *   updates                  the log: every change in the bytes it arrived as, oldest
   *                            first. `bytes` is stored beside the data so a sum does not
   *                            have to read any of it.
   *   snapshot_chunks          the snapshot, cut into `SNAPSHOT_CHUNK_BYTES` rows so a
   *                            board can grow without a row outgrowing the engine.
   *   quarantined_updates      log rows that would not read, with the error that moved
   *                            them there and when. Nothing is deleted to make room for
   *                            them.
   */
  migrate(): void {
    this.exec('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.exec('CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)');
    this.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.exec('CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)');
    if (this.meta('storage_schema_version') === null) {
      this.setMeta('storage_schema_version', String(STORAGE_SCHEMA_VERSION));
    }
    this.poisoned = (this.meta(POISONED) as StoreOperation | null) ?? null;
    this.note(`migrate: schema=${this.meta('storage_schema_version')}`);
  }

  // --- reading a board back -------------------------------------------------

  /**
   * Read a board into `doc`: the snapshot first, then the log from `snapshot_through_seq`.
   *
   * The reading happens in a document that is then thrown away, and that is the whole trick
   * behind "a load that fails applies nothing": a board is either applied in full or not at
   * all, and a room that could not read its board is left holding exactly what it had
   * before it tried — which for a room that has just woken is nothing at all, and is the
   * difference between "this board could not be loaded" and "this board is empty".
   *
   * Everything is applied to `doc` under `LOAD_ORIGIN`, which is how the room tells a board
   * it read from disk from a change a person made, and why reading a board back does not
   * write the board back down.
   */
  load(doc: Y.Doc): LoadResult {
    const outer = this.inside;
    this.inside = 'load';
    try {
      return this.transaction(() => this.loadInto(doc));
    } catch (error) {
      // A load that failed on its own terms. The transaction rolled back, so the log and
      // the snapshot are as they were and the room's document was never reached.
      const message = reasonOf(error);
      this.note(`load: failed: sql-error: ${message}`);
      return { ok: false, reason: 'sql-error', error: message };
    } finally {
      this.inside = outer;
    }
  }

  private loadInto(doc: Y.Doc): LoadResult {
    const snapshot = this.readSnapshot();
    if (snapshot === null) {
      this.note(`load: failed: snapshot-unreadable: ${this.damage}`);
      return { ok: false, reason: 'snapshot-unreadable', error: this.damage ?? 'unreadable' };
    }

    // The board is assembled somewhere it can be thrown away.
    const board = new Y.Doc();
    // The same setup every board document gets, before the stored bytes are applied. This is
    // not ceremony: an update that refers to part of a document the receiving document does not
    // have is not rejected, it is *quietly parked* in Yjs's pending queue, and a board whose
    // changes were parked like that would load as an empty board with no error anywhere. The
    // document this store writes into has to be the kind of document those changes were made to.
    initDoc(board);
    if (snapshot.byteLength > 0) Y.applyUpdate(board, snapshot, LOAD_ORIGIN);

    this.throughSeq = Number(this.meta('snapshot_through_seq') ?? 0);
    let applied = 0;
    let quarantined = 0;
    let bytes = 0;

    /** Move one row out of the log and into the rows that could not be read, with the reason. */
    const quarantine = (seq: number, update: Uint8Array, message: string): void => {
      this.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.exec('INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)', seq, update, message, Date.now());
      this.note(`load: update quarantined: seq=${seq} bytes=${update.byteLength} error=${message}`);
    };

    for (const row of this.logRows()) {
      const update = asBytes(row.data);
      try {
        Y.applyUpdate(board, update, LOAD_ORIGIN);
      } catch (error) {
        // This row's problem, and only this row's: it leaves the log with the error that
        // moved it and the rest of the board goes on loading.
        quarantine(row.seq, update, reasonOf(error));
        quarantined += 1;
        continue;
      }
      // The failure that does not fail. When an update refers to part of a document this one
      // never received, Yjs does not complain: it parks the update and carries on, and the board
      // loads as a board with holes in it and no error anywhere. That is what happens to the rows
      // after a damaged row — they refer to whatever the damaged row was going to create — and it
      // is the difference between a board that says how much of it it could not read and a board
      // that shows 6 of its 25 notes and says nothing. So a parked row is moved out of the log the
      // same way an unreadable one is, with a reason that says what happened.
      const parkedBy = parkedIn(board);
      if (parkedBy !== null) {
        clearParkedIn(board);
        quarantine(row.seq, update, parkedBy);
        quarantined += 1;
        continue;
      }
      applied += 1;
      bytes += update.byteLength;
    }

    // Only now is the room's document told anything: every row has been read, and what
    // arrives is the board.
    const state = Y.encodeStateAsUpdate(board);
    board.destroy();
    Y.applyUpdate(doc, state, LOAD_ORIGIN);

    // What the tables hold now, including the rows that just moved to quarantine.
    this.refresh();
    this.note(`load: loaded: snapshot=${snapshot.byteLength} bytes through=${this.throughSeq}, updates=${applied}, quarantined=${quarantined}, doc=${state.byteLength} bytes`);
    return { ok: true, quarantined };
  }

  /**
   * The snapshot as one update, or `null` when it is there and is not a board.
   *
   * The rows are read in `idx` order and joined once, because a snapshot was cut into rows
   * for no other reason than that one row could not hold it. Nothing is applied here, so
   * deciding that a snapshot is unreadable leaves nothing to undo.
   */
  private readSnapshot(): Uint8Array | null {
    this.throughSeq = Number(this.meta('snapshot_through_seq') ?? 0);
    if (this.throughSeq === 0) return new Uint8Array(0);

    const rows: Uint8Array[] = [];
    for (const row of this.exec('SELECT data FROM snapshot_chunks ORDER BY idx')) rows.push(asBytes(row.data));
    const snapshot = joinChunks(rows);
    if (snapshot.byteLength === 0) {
      // The log says a snapshot was folded and there is nothing to show for it. That is not
      // an empty board, it is a board whose contents are missing.
      this.damage = 'snapshot_through_seq is set and snapshot_chunks is empty';
      return null;
    }
    try {
      Y.decodeUpdate(snapshot);
    } catch (error) {
      this.damage = reasonOf(error);
      return null;
    }
    return snapshot;
  }

  /** The log, oldest first, in batches, and only the rows the snapshot does not contain. */
  private *logRows(): Generator<{ seq: number; data: unknown }> {
    let after = this.throughSeq;
    for (;;) {
      const rows = Array.from(
        this.exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq LIMIT ?', after, BoardStore.READ_BATCH),
      );
      if (rows.length === 0) return;
      for (const row of rows) {
        after = Number(row.seq);
        yield { seq: after, data: row.data };
      }
      if (rows.length < BoardStore.READ_BATCH) return;
    }
  }

  // --- writing a board ------------------------------------------------------

  /**
   * Add one change to the log, in the bytes it arrived as.
   *
   * This is the only thing that happens to a change between "a client sent it" and
   * "everybody was told": one insert, in its own transaction, synchronous. It either lands
   * or it throws, and a room that could not land a change has to stop and say so rather than
   * go on behaving as though the board were fine.
   */
  append(update: Uint8Array): void {
    const outer = this.inside;
    this.inside = 'append';
    try {
      this.transaction(() => {
        this.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.byteLength);
      });
      this.counters = { updates: this.counters.updates + 1, bytes: this.counters.bytes + update.byteLength };
    } catch (error) {
      const message = reasonOf(error);
      this.failures.push({ operation: 'append', error: message });
      // No row, so whatever that change contained exists only in the sender's document and
      // in the memory of whoever is watching it. The room closes every socket on this.
      this.note(`storage-failed: append: ${message} (update=${update.byteLength} bytes)`);
      throw error;
    } finally {
      this.inside = outer;
    }
  }

  /**
   * Fold the log into a snapshot of the whole board when the log has grown long enough.
   *
   * One transaction, so a board is never seen in the middle: either the new snapshot and the
   * emptied log are both true, or the old snapshot and the whole log are. When the write goes
   * wrong that second line is still what the board *is*, which is why this returns `false`
   * instead of throwing and why nobody is told — the notes are safe either way, and the next
   * change will try again.
   *
   * The snapshot is encoded from the room's own document, which already holds the old
   * snapshot plus every change since, so folding never reads the board back first. Yjs
   * garbage-collects deleted content, so a snapshot tracks what is on the board rather than
   * everything that was ever typed on it.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    const outer = this.inside;
    this.inside = 'compaction';
    try {
      const before = this.counters;
      if (!force && !shouldCompact(before.updates, before.bytes)) return false;

      if (this.damage !== null) {
        // The one write that empties the log. While a snapshot this store cannot read is in
        // the tables, folding the log into a snapshot of a board that is missing whatever
        // that snapshot holds is how "unreadable" turns into "lost".
        this.note(`compaction: skipped: snapshot-unreadable: ${this.damage}`);
        return false;
      }

      const snapshot = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(snapshot);
      const throughSeq = this.lastSeq();
      try {
        this.transaction(() => {
          this.exec('DELETE FROM snapshot_chunks');
          for (const [index, chunk] of chunks.entries()) {
            this.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index + 1, chunk);
          }
          // The log's whole reason for existing is the snapshot it is ahead of. Once the
          // snapshot says everything the log said, the log is a tail.
          this.exec('DELETE FROM updates WHERE seq <= ?', throughSeq);
          this.setMeta('snapshot_through_seq', String(throughSeq));
        });
      } catch (error) {
        const message = reasonOf(error);
        this.failures.push({ operation: 'compaction', error: message });
        // Rolled back by the transaction, not by anything in this file: the old chunks and
        // every log row are still there.
        this.note(`compaction: rolled-back: ${message} (updates=${before.updates}, bytes=${before.bytes})`);
        this.refresh();
        return false;
      }

      this.throughSeq = throughSeq;
      this.refresh();
      this.note(
        `compaction: performed: updates=${before.updates}, bytes=${before.bytes} -> snapshot=${snapshot.byteLength} bytes in ${chunks.length} chunks, through_seq=${throughSeq}`,
      );
      return true;
    } finally {
      this.inside = outer;
    }
  }

  // --- what the tables hold -------------------------------------------------

  /**
   * How much log there is.
   *
   * Kept in memory and updated as rows come and go, because this is asked after every write
   * and a `COUNT(*)` over the log per keystroke is a cost the board should not pay. Load and
   * compaction re-read the real figures, so the two cannot drift apart over time.
   */
  logCounters(): LogCounters {
    return { ...this.counters };
  }

  /** Re-read the log's size from the tables. */
  refresh(): LogCounters {
    const row = firstRow<{ updates: number; bytes: number }>(
      this.exec('SELECT COUNT(*) AS updates, COALESCE(SUM(bytes), 0) AS bytes FROM updates WHERE seq > ?', this.throughSeq),
    );
    this.counters = { updates: Number(row?.updates ?? 0), bytes: Number(row?.bytes ?? 0) };
    return this.logCounters();
  }

  /** Whether this board's log has grown enough to fold away. */
  compactionNeeded(): boolean {
    return shouldCompact(this.counters.updates, this.counters.bytes);
  }

  /** How much of this board is where it can be read back. */
  stats(): BoardStats {
    const log = this.refresh();
    const snapshot = firstRow<{ chunks: number; bytes: number }>(
      this.exec('SELECT COUNT(*) AS chunks, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_chunks'),
    );
    const quarantined = firstRow<{ count: number; bytes: number }>(
      this.exec('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM quarantined_updates'),
    );
    return {
      ...log,
      snapshot: {
        throughSeq: this.throughSeq,
        chunks: Number(snapshot?.chunks ?? 0),
        bytes: Number(snapshot?.bytes ?? 0),
        unreadable: this.damage !== null,
      },
      quarantined: { count: Number(quarantined?.count ?? 0), bytes: Number(quarantined?.bytes ?? 0) },
      storageSchemaVersion: Number(this.meta('storage_schema_version') ?? 0),
      storageFailures: this.failures.length,
    };
  }

/** The largest log row in the tables, which is what a snapshot is about to contain. */
  private lastSeq(): number {
    return Number(firstRow<{ seq: number }>(this.exec('SELECT MAX(seq) AS seq FROM updates'))?.seq ?? 0);
  }

  /** Why this board would not load, while this store knows it. */
  get unreadable(): string | null {
    return this.damage;
  }

  // --- for the test hooks (TEST_HOOKS) --------------------------------------

  /**
   * Make a statement inside `operation` throw, once, after `through` of its statements have
   * gone through.
   *
   * `through` is the difference between a failure that happens before anything was written
   * and one that happens in the middle of a transaction: only the second says anything about
   * whether a rollback really does roll back. The default is the first statement.
   *
   * The failure is raised in front of the room's own `storage.sql` at the point where a real
   * failure would have been raised, and nothing in this file catches it on the way to the
   * runtime. That is what makes an injected failure evidence rather than a rehearsal: the
   * rollback, the close code and the log line all have to be the real ones for the test that
   * uses this to pass.
   */
  injectFailure(operation: StoreOperation, through = 0): void {
    this.armed = { operation, through };
    this.note(`injected: ${operation} will fail after ${through} statement${through === 1 ? '' : 's'}`);
  }

  /** Stop injecting. */
  clearInjection(): void {
    this.armed = null;
  }

  /**
   * Make reading this board fail, in this object and in every object that comes after it, until
   * `healReads` is called.
   *
   * This is the difference between a broken board and a grumpy object: a read error belongs to the
   * storage, so a test that wants to know what a room does when it cannot read its board has to
   * arrange for the read to fail *after* the room has been put away and rebuilt. Writing the
   * failure into the same tables as the board is how it survives that.
   */
  poisonReads(operation: StoreOperation = 'load'): void {
    this.setMeta(POISONED, operation);
    this.poisoned = operation;
    this.note(`injected: ${operation} will fail on every read until it is healed`);
  }

  /** Stop the reads from failing. */
  healReads(): void {
    this.exec('DELETE FROM storage_meta WHERE key = ?', POISONED);
    this.poisoned = null;
    this.note('repaired: reads are failing no more');
  }

  /**
   * Write nonsense over the stored snapshot, so that a test can ask what happens when a board's
   * own bytes stop being a board.
   *
   * It damages a chunk in place and moves nothing else — in particular it does not touch
   * `snapshot_through_seq`, because that is the difference between damaging a board and
   * deleting one: with the log still pointing at the snapshot it is covered by, the rows are
   * still there and a test can see that a load which could not read the board changed nothing.
   *
   * The bytes it overwrites are kept, in the one table a test writes to, so that the same test
   * can put the board back and see what a repaired board does. A repair that had to rebuild the
   * snapshot would be a second feature under test, and the story is about what happens to a
   * board that cannot be read.
   */
  corruptSnapshot(): void {
    const row = firstRow<{ idx: number }>(this.exec('SELECT idx FROM snapshot_chunks ORDER BY idx LIMIT 1'));
    if (row === undefined) {
      // There is no snapshot to damage: a board whose whole history is still in the log has
      // nothing to corrupt here, and inventing one would be a fixture pretending to be damage.
      this.note('corrupt: snapshot: refused, there is no snapshot to corrupt');
      return;
    }
    const idx = Number(row.idx);
    if (this.meta(SAVED_CHUNK) === null) {
      const original = firstRow<{ data: unknown }>(this.exec('SELECT data FROM snapshot_chunks WHERE idx = ?', idx));
      if (original !== undefined) this.setMeta(SAVED_CHUNK, toBase64(asBytes(original.data)));
    }
    const garbage = new Uint8Array([0, 255, 7, 255, 0, 255, 255, 0]);
    this.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', garbage, idx);
    this.damage = 'injected: snapshot_chunks does not hold a board';
    this.note(`corrupt: snapshot: idx=${idx} bytes=${garbage.byteLength} (the log is untouched)`);
  }

  /**
   * Put back the snapshot `corruptSnapshot` damaged. Returns false when nothing was ever
   * damaged, which is a test asking for a repair that has nothing to do.
   */
  restoreSnapshot(): boolean {
    const saved = this.meta(SAVED_CHUNK);
    if (saved === null) {
      this.note('repair: snapshot: refused, nothing was damaged');
      return false;
    }
    const bytes = fromBase64(saved);
    this.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 1', bytes);
    this.exec('DELETE FROM storage_meta WHERE key = ?', SAVED_CHUNK);
    this.damage = null;
    this.note(`repair: snapshot: ${bytes.byteLength} bytes`);
    return true;
  }

  /**
   * Replace the oldest log row with bytes that cannot be an update, so that whatever it
   * contained cannot be read back. Everything after it is left alone: this is one bad note,
   * not a bad board.
   */
  corruptOldestUpdate(): number {
    const row = firstRow<{ seq: number }>(this.exec('SELECT seq FROM updates ORDER BY seq LIMIT 1'));
    if (!row) return 0;
    const seq = Number(row.seq);
    this.exec('UPDATE updates SET data = ?, bytes = 3 WHERE seq = ?', new Uint8Array([1, 2, 3]), seq);
    this.note(`corrupt: update: seq=${seq}`);
    return seq;
  }

  /** Put the real bytes of a log row back, which is what "repaired" means for a test. */
  repairUpdate(seq: number, update: Uint8Array): void {
    this.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = ?', update, update.byteLength, seq);
    this.note(`repair: update: seq=${seq} bytes=${update.byteLength}`);
  }

  /** Write over the snapshot with the real contents of `doc`, which repairs the damage. */
  repairSnapshot(doc: Y.Doc): void {
    const snapshot = Y.encodeStateAsUpdate(doc);
    this.transaction(() => {
      this.exec('DELETE FROM snapshot_chunks');
      for (const [index, chunk] of chunkBytes(snapshot).entries()) {
        this.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index + 1, chunk);
      }
      this.setMeta('snapshot_through_seq', String(this.lastSeq()));
      this.exec('DELETE FROM updates');
    });
    this.damage = null;
    this.refresh();
    this.note(`repair: snapshot: ${snapshot.byteLength} bytes`);
  }

  /**
   * Replace one log row with bytes that cannot be an update, and leave every other row alone.
   *
   * The only way to be sure what a board does with a damaged row is to put a damaged row in it.
   * This is not a way in: it is reached from tests and from the test hooks, and it writes to a
   * table no client writes to.
   */
  damageUpdate(seq: number, bytes: Uint8Array): void {
    this.exec('UPDATE updates SET data = ?, bytes = ? WHERE seq = ?', bytes, bytes.byteLength, seq);
    this.note(`corrupt: update: seq=${seq} bytes=${bytes.byteLength}`);
  }

  /** Every row of the stored snapshot, in the order it was written. */
  snapshotRows(): { index: number; bytes: number; data: Uint8Array }[] {
    return Array.from(this.exec('SELECT idx, LENGTH(data) AS bytes, data FROM snapshot_chunks ORDER BY idx'), (row) => ({
      index: Number(row.idx),
      bytes: Number(row.bytes),
      data: asBytes(row.data),
    }));
  }

  /** Every row of the log, oldest first — what a test looks at to see what was written. */
  logEntries(): { seq: number; bytes: number; data: Uint8Array }[] {
    const rows = this.exec('SELECT seq, bytes, data FROM updates ORDER BY seq');
    return Array.from(rows, (row) => ({
      seq: Number(row.seq),
      bytes: Number(row.bytes),
      data: asBytes(row.data),
    }));
  }

  /** The quarantined rows, with what the store said about each of them. */
  quarantine(): { seq: number; error: string; bytes: number }[] {
    return Array.from(
      this.exec('SELECT seq, error, LENGTH(data) AS bytes FROM quarantined_updates ORDER BY seq'),
      (row) => ({ seq: Number(row.seq), error: String(row.error), bytes: Number(row.bytes) }),
    );
  }

  /** A stored value, for the two `storage_meta` keys and for tests that write their own. */
  meta(key: string): string | null {
    const row = firstRow<{ value: string }>(this.exec('SELECT value FROM storage_meta WHERE key = ?', key));
    return row === undefined ? null : String(row.value);
  }

  private setMeta(key: string, value: string): void {
    this.exec('INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  // --- storage, and the place a failure can be put in front of it -----------

  /**
   * Put the injection in front of the room's own `storage.sql`.
   *
   * The property is replaced on the object the room holds, in place, with a getter that hands
   * back the real `SqlStorage` when nothing is armed and a wrapper over it when something is.
   * The wrapper calls straight through to the object it replaced, so it cannot recurse — it
   * has no way to reach itself. Only `exec` is asked "is this the statement I was told to
   * fail?", which leaves `transactionSync`, and the rollback the runtime performs when a
   * transaction throws, exactly as they are in production. When nothing is armed the getter
   * returns the original object, so a board nobody is testing touches nothing here.
   */
  private putFailuresInFrontOfStorage(): void {
    const holder = this.storage as unknown as { sql: SqlExecutor };
    const original = holder.sql;
    const exec = (query: string, ...bindings: unknown[]) => {
      const armed = this.armed;
      if (this.poisoned !== null && this.poisoned === this.inside) {
        throw new Error(`injected: ${this.poisoned} could not be read`);
      }
      if (armed !== null && armed.operation === this.inside) {
        if (armed.through <= 0) {
          this.armed = null;
          throw new Error(`injected: ${armed.operation} failed`);
        }
        armed.through -= 1;
      }
      return (original.exec as (q: string, ...b: unknown[]) => SqlRows).call(original, query, ...bindings);
    };

    const wrapper = new Proxy(original, {
      get: (target, key) => (key === 'exec' ? exec : Reflect.get(target, key)),
    });
    Object.defineProperty(holder, 'sql', {
      configurable: true,
      enumerable: true,
      // Both kinds of failure are asked about in the one place, so both of them have to be in
      // front of the storage: an armed statement that is told to throw, and a read that this
      // board's own tables say fails. A board that is poisoned is a board whose reads go
      // through here whether or not anything else is armed.
      get: (): SqlExecutor => (this.armed === null && this.poisoned === null ? original : wrapper),
    });
  }

  private transaction<T>(work: () => T): T {
    return this.storage.transactionSync(work);
  }

  private exec(query: string, ...bindings: unknown[]): SqlRows {
    return this.storage.sql.exec(query, ...bindings);
  }

  private note(line: string): void {
    this.lines.push(line);
    this.log(line);
  }
}
