/**
 * One board's storage, inside its Durable Object's SQLite database.
 *
 * A board is a Yjs document, and a Yjs document is a log of updates: append what
 * happened and replay it and you get the board back. That is the whole design,
 * and it buys the properties the story is about — every change is written the
 * moment it is applied, so there is nothing to save, and a board that nobody has
 * open is just rows on disk, costing no compute until somebody arrives.
 *
 * ```text
 *  storage_meta          storage_schema_version, snapshot_through_seq
 *  updates               the log: one row per Yjs update, in seq order
 *  snapshot_chunks       the folded log, in SNAPSHOT_CHUNK_BYTES pieces
 *  quarantined_updates   log rows that could not be read, kept for diagnosis
 * ```
 *
 * Four rules hold this together:
 *
 *  - **Writing is cheap and synchronous.** All the SQL here is synchronous, so
 *    `append` lands in the same turn as the change, and the room can promise that
 *    nobody sees a change that is not stored. (The runtime holds outgoing messages
 *    until the write is confirmed, which is what turns that into "seen by someone
 *    else means saved".)
 *  - **A snapshot is chunked.** The platform caps the size of one row, and a
 *    2,000-note board's encoded state is comfortably bigger than a small file;
 *    `SNAPSHOT_CHUNK_BYTES` keeps every row well under the cap whatever the board
 *    holds.
 *  - **A failed load leaves nothing behind.** The board is rebuilt into a document
 *    of this module's own and copied into the caller's only when all of it read.
 *    Half a board is worse than no board: it looks like somebody's work was
 *    deleted.
 *  - **Damage is contained.** A log row that will not apply is moved to
 *    `quarantined_updates` and the board is rebuilt without it (one bad change must
 *    not cost a workshop). A snapshot that will not apply is fatal to the load —
 *    and it says so, rather than handing back an empty board.
 */

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION
} from '../shared/config';

/**
 * Transaction origin for updates applied while loading.
 *
 * Loading a board must not store it back to itself, and must not broadcast it to
 * nobody: tagging those transactions is how the room tells "the board arrived"
 * from "somebody changed something".
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** `storage_meta` keys. */
const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';

/**
 * The row that says this board was created.
 *
 * A board *exists* when this key is set, or — for boards that were already holding
 * content before links were issued (`share.legacy_boards`) — when it has any update or
 * snapshot bytes at all. Nothing else counts: an empty set of tables is not a board,
 * which is what lets a mistyped link be answered without writing anything.
 */
const META_CREATED_AT = 'created_at';

/**
 * Where the test hook hides the snapshot chunk it damaged, so it can put it back.
 * Not a board, not part of the schema: a scratch key in the same storage.
 */
const DAMAGED_CHUNK_KEY = '__test_damaged_snapshot_chunk_0';

/** The tables, one database per board. Every statement is idempotent. */
const SCHEMA_STATEMENTS = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)'
];

/** Why a board could not be read, or how much of it had to be left behind. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split `data` into pieces of at most `size` bytes.
 *
 * Empty input is no chunks at all (not one empty chunk): "there is no snapshot"
 * and "the snapshot is empty" must not be written differently, and `joinChunks`
 * of nothing is nothing.
 */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(`chunk size must be positive, got ${size}`);
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.byteLength; start += size) {
    chunks.push(data.subarray(start, Math.min(start + size, data.byteLength)));
  }
  return chunks;
}

/** Put the pieces back, byte for byte. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Is the log big enough to be worth folding into a snapshot?
 *
 * Either limit on its own is enough: many small updates (a long typing session)
 * hit the row count, a few big ones (a board pasted in) hit the byte count.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** A fresh `ArrayBuffer` holding exactly `data` (a view is not a value). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/** A BLOB column back into bytes, however the engine handed it over. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('stored update is not a blob');
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

/** A log row, as read for replay. */
interface LogRow {
  readonly seq: number;
  readonly data: unknown;
}

/** What rebuilding a board ended up with. */
type Replay =
  | { ok: true; doc: Y.Doc; applied: number; bytes: number }
  | { ok: false; failure: 'snapshot'; error: string }
  | { ok: false; failure: 'row'; row: LogRow; error: string };

/**
 * Build a document from the snapshot plus the log rows that are still readable.
 *
 * `skipped` holds the rows already known to be damaged. A row that throws is
 * reported rather than swallowed mid-loop, because a Yjs document that refused an
 * update halfway is no longer a safe base for the rows after it: the caller
 * quarantines the row and rebuilds, which is what makes "everything else is
 * intact" true rather than approximately true.
 */
function replayRows(
  snapshotBytes: Uint8Array | null,
  rows: readonly LogRow[],
  skipped: ReadonlySet<number>
): Replay {
  const doc = new Y.Doc();
  if (snapshotBytes !== null) {
    try {
      Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
    } catch (error) {
      return { ok: false, failure: 'snapshot', error: reason(error) };
    }
  }

  let applied = 0;
  let bytes = 0;
  for (const row of rows) {
    if (skipped.has(row.seq)) continue;
    const update = toBytes(row.data);
    try {
      Y.applyUpdate(doc, update, LOAD_ORIGIN);
      applied += 1;
      bytes += update.byteLength;
    } catch (error) {
      return { ok: false, failure: 'row', row, error: reason(error) };
    }
  }
  return { ok: true, doc, applied, bytes };
}

/**
 * The storage of exactly one board.
 *
 * Row counts and byte totals are kept in memory after `load` so appending does
 * not cost a `COUNT(*)` per keystroke.
 */
export class BoardStore {
  private readonly storage: DurableObjectStorage;

  /**
   * Whether this database is known to have the tables.
   *
   * Opening a board is not a write (story 5): the tables are created by `initialize`,
   * or lazily by the first `append`, and never by a read. Once they are known to be
   * there the question is not asked again.
   */
  private tablesKnown = false;

  /** Rows currently in the log (those after `snapshotThroughSeq`). */
  private logRows = 0;

  /** Total stored bytes of those rows. */
  private logBytes = 0;

  /** The highest `seq` ever written here — 0 when nothing has been written. */
  private lastSeq = 0;

  /** Every update with `seq <= snapshotThroughSeq` is inside the snapshot. */
  private snapshotThroughSeq = 0;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  private get sql() {
    return this.storage.sql;
  }

  /** How much log is waiting to be folded. */
  get logSize(): { rows: number; bytes: number } {
    return { rows: this.logRows, bytes: this.logBytes };
  }

  /**
   * Everything the board holds right now, log and snapshot counted separately: the
   * status endpoint reports the sum, and a test that wants to know whether folding
   * happened reads the two.
   */
  totals(): { logRows: number; logBytes: number; snapshotBytes: number } {
    const row = this.sql.exec('SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM snapshot_chunks').one();
    return { logRows: this.logRows, logBytes: this.logBytes, snapshotBytes: Number(row.bytes as number) };
  }

  /**
   * Create the tables and record the storage version.
   *
   * Writes no update rows: opening a board that has never been edited must not
   * change what it holds, and an empty board is an empty board, not a fact to
   * record about itself.
   */
  migrate(): void {
    this.storage.transactionSync(() => {
      for (const statement of SCHEMA_STATEMENTS) this.sql.exec(statement);
      this.sql.exec(
        'INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)',
        META_SCHEMA_VERSION,
        String(STORAGE_SCHEMA_VERSION)
      );
    });
    this.tablesKnown = true;
  }

  /**
   * Make this board exist: the tables, and the `created_at` row that is what
   * "exist" means (`share.unguessable`, `share.not_found`).
   *
   * Idempotent, and the second call says so rather than rewriting the first: a board
   * must never be re-initialised, and its creation time is a fact about the day it was
   * made, not about whoever knocked last (TC-15).
   */
  initialize(): 'created' | 'exists' {
    this.migrate();
    let created = false;
    this.storage.transactionSync(() => {
      if (this.metaRow(META_CREATED_AT) === undefined) {
        this.sql.exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', META_CREATED_AT, String(Date.now()));
        created = true;
      }
    });
    return created ? 'created' : 'exists';
  }

  /**
   * Is there a board in here?
   *
   * Reads, and only reads: no tables means no board and no tables, so a stranger
   * walking up to a mistyped link leaves nothing behind (TC-06, TC-09). A board counts
   * when it was created, or when it holds content from before links were issued.
   */
  existsReadOnly(): boolean {
    const tables = this.tableNames();
    if (tables.size === 0) return false;
    if (tables.has('storage_meta') && this.metaRow(META_CREATED_AT) !== undefined) return true;
    if (tables.has('updates') && this.hasRows('updates')) return true;
    return tables.has('snapshot_chunks') && this.hasRows('snapshot_chunks');
  }

  /**
   * Write a log of updates without claiming the board was created.
   *
   * This is how a board from before this feature is reproduced in a test: rows and no
   * `created_at`, which is exactly the shape `existsReadOnly` has to be generous about
   * (`share.legacy_boards`). Production code never calls it.
   */
  seedLegacy(updates: readonly Uint8Array[]): number {
    this.migrate();
    return this.storage.transactionSync(() => {
      for (const update of updates) {
        this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toArrayBuffer(update), update.byteLength);
      }
      return this.sql.exec('SELECT COUNT(*) AS count FROM updates').one().count as number;
    });
  }

  /** The names of the tables this database holds right now. */
  private tableNames(): Set<string> {
    return new Set(
      this.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((row) => String(row.name))
    );
  }

  /** Does this table hold anything? (`updates` and `snapshot_chunks` only.) */
  private hasRows(table: 'updates' | 'snapshot_chunks'): boolean {
    return this.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length > 0;
  }

  /**
   * Create the tables if a write needs them and they are not there.
   *
   * A board that only ever gets read stays exactly as empty as it was; the first
   * change to it is the moment its storage is made. Legacy boards already have their
   * tables, so this costs them one cached answer.
   */
  private ensureMigrated(): void {
    if (this.tablesKnown) return;
    this.migrate();
  }

  /**
   * Add one update to the log.
   *
   * Throws whatever SQLite throws: the room cannot broadcast a change it has not
   * stored, so a failure here is the caller's signal to reset itself rather than
   * pretend.
   */
  append(update: Uint8Array): void {
    this.ensureMigrated();
    const bytes = update.byteLength;
    const seq = this.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', toArrayBuffer(update), bytes);
      return this.maxSeq();
    });
    this.logRows += 1;
    this.logBytes += bytes;
    this.lastSeq = seq;
  }

  /**
   * Fill `doc` with everything this board holds: the snapshot, then the log rows
   * written after it.
   *
   * Nothing here can leave the caller with a board that looks empty but is not:
   * an unreadable snapshot or a failing read returns `{ ok: false }` and leaves
   * `doc` exactly as it was. A single log row that will not apply is the one
   * exception the story asks for — it is moved aside, counted, and the rest of
   * the board is there.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      if (!this.tableNames().has('updates')) {
        // Nothing has ever been written here. That is an empty board rather than a
        // broken one — and reading it must not be the thing that creates it, because
        // nobody has decided this address is a board yet (`share.not_found`).
        this.snapshotThroughSeq = 0;
        this.logRows = 0;
        this.logBytes = 0;
        this.lastSeq = 0;
        return { ok: true, quarantined: 0 };
      }
      this.tablesKnown = true;
      this.snapshotThroughSeq = this.metaNumber(META_SNAPSHOT_THROUGH_SEQ);
      const chunkRows = this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC').toArray();
      const snapshotBytes =
        chunkRows.length > 0 ? joinChunks(chunkRows.map((row) => toBytes(row.data))) : null;

      const rows: LogRow[] = this.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq ASC', this.snapshotThroughSeq)
        .toArray()
        .map((row) => ({ seq: asNumber(row.seq), data: row.data }));

      const quarantined = new Set<number>();
      for (;;) {
        const attempt = replayRows(snapshotBytes, rows, quarantined);
        if (attempt.ok) {
          // All of it read: only now does the caller's document change.
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(attempt.doc), LOAD_ORIGIN);
          this.logRows = attempt.applied;
          this.logBytes = attempt.bytes;
          const highest = rows.length > 0 ? rows[rows.length - 1].seq : this.snapshotThroughSeq;
          this.lastSeq = highest;
          return { ok: true, quarantined: quarantined.size };
        }
        if (attempt.failure === 'snapshot') {
          // The snapshot is most of the board, and every row stays where it is: a
          // later attempt, or a repair, still needs the log that is good.
          console.error(
            JSON.stringify({
              event: 'board-snapshot-unreadable',
              chunks: chunkRows.length,
              error: attempt.error
            })
          );
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: attempt.error
          };
        }
        // One damaged row out of an otherwise healthy board: move it aside and
        // rebuild. Each damaged row costs exactly one rebuild, so this terminates.
        this.quarantine(attempt.row, attempt.error);
        quarantined.add(attempt.row.seq);
      }
    } catch (error) {
      // Storage itself is unreadable. That is not an empty board either.
      console.error(JSON.stringify({ event: 'board-load-sql-error', error: reason(error) }));
      return { ok: false, reason: 'sql-error', error: reason(error) };
    }
  }

  /**
   * Fold the log into a snapshot when it has grown past either limit.
   *
   * One `transactionSync`, so the new snapshot, the truncated log and the new
   * `snapshot_through_seq` land together or not at all: a compaction that fails
   * halfway must not cost the board its history, and the worst it can do is
   * return `false` and try again next time.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logRows, this.logBytes)) return false;
    return this.fold(doc);
  }

  /**
   * Fold the log whatever its size.
   *
   * Only the test hook needs this (story 4's TC-24): a board with a handful of notes
   * is nowhere near the folding threshold, and to damage a snapshot there has to be
   * one. Nothing in the room calls it — folding stays the room's own decision.
   */
  compactNow(doc: Y.Doc): boolean {
    return this.fold(doc);
  }

  /** Write the document out as the snapshot, and delete the log it covers. */
  private fold(doc: Y.Doc): boolean {
    let encoded: Uint8Array;
    try {
      // The in-memory document already holds snapshot + log, so this is the whole
      // board; Yjs garbage-collects deleted content, so it tracks the board's
      // current size rather than its history.
      encoded = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'board-compaction-encode-failed',
          error: reason(error)
        })
      );
      return false;
    }

    const chunks = chunkBytes(encoded);
    const through = this.lastSeq;
    try {
      this.storage.transactionSync(() => {
        this.clearSnapshotChunks();
        chunks.forEach((chunk, index) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index, toArrayBuffer(chunk));
        });
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', through);
        this.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          META_SNAPSHOT_THROUGH_SEQ,
          String(through)
        );
      });
    } catch (error) {
      // `transactionSync` rolled everything back: the old snapshot and the whole
      // log are still there, which is why returning false here is safe.
      console.error(
        JSON.stringify({
          event: 'board-compaction-failed',
          chunks: chunks.length,
          through,
          error: reason(error)
        })
      );
      return false;
    }

    this.snapshotThroughSeq = through;
    this.logRows = 0;
    this.logBytes = 0;
    return true;
  }

  /**
   * Overwrite snapshot chunk 0 with bytes of the same length, keeping the original so
   * it can be put back. Only the test hook calls this (story 4's TC-24), and the
   * replacement is random on purpose: a run of zeros *does* decode, into a
   * part-populated board, which is the failure this story must not confuse with the
   * real one (`NOTES.md`).
   */
  async damageSnapshotChunkZero(): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
    const rows = this.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = 0').toArray();
    const original = rows.length === 0 ? null : toBytes(rows[0].data as Uint8Array | ArrayBuffer);
    if (original === null || original.byteLength === 0) return { ok: false, reason: 'no-snapshot' };
    await this.storage.put(DAMAGED_CHUNK_KEY, toArrayBuffer(original));
    const damage = new Uint8Array(original.byteLength);
    crypto.getRandomValues(damage);
    this.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', toArrayBuffer(damage));
    return { ok: true, bytes: original.byteLength };
  }

  /** Put back what `damageSnapshotChunkZero` took away. */
  async restoreSnapshotChunkZero(): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
    const saved = await this.storage.get<ArrayBuffer>(DAMAGED_CHUNK_KEY);
    if (!saved) return { ok: false, reason: 'nothing-was-damaged' };
    this.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', saved);
    await this.storage.delete(DAMAGED_CHUNK_KEY);
    return { ok: true, bytes: saved.byteLength };
  }

  /**
   * Drop the old snapshot rows, inside the compaction transaction.
   *
   * Separate so a test can make it fail *after* it ran, which is the one moment a
   * compaction can lose data if the rollback does not work.
   */
  protected clearSnapshotChunks(): void {
    this.sql.exec('DELETE FROM snapshot_chunks');
  }

  /** The highest seq in the log, or the snapshot's if the log is empty. */
  private maxSeq(): number {
    const row = this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS top FROM updates').one();
    const top = asNumber(row.top);
    return top > 0 ? top : this.snapshotThroughSeq;
  }

  private metaNumber(key: string): number {
    const value = Number(this.metaRow(key) ?? '0');
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /** One `storage_meta` value, or undefined when the key is not there. */
  private metaRow(key: string): string | undefined {
    const row = this.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key).toArray()[0];
    return row === undefined ? undefined : String(row.value);
  }

  /**
   * Move a row that would not apply out of the log, keeping the bytes and the
   * reason. The board loads without it; the evidence stays for whoever looks.
   */
  private quarantine(row: LogRow, error: string): void {
    try {
      const blob = toArrayBuffer(toBytes(row.data));
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
        this.sql.exec(
          'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          row.seq,
          blob,
          error,
          Date.now()
        );
      });
    } catch (moveError) {
      // The row stays in the log, but the loader has already written it off for
      // this pass, so the board still opens. Loud, because the alternative is
      // quietly serving less than the board holds.
      console.error(
        JSON.stringify({
          event: 'board-quarantine-failed',
          seq: row.seq,
          error: reason(moveError)
        })
      );
    }
    console.error(
      JSON.stringify({
        event: 'board-update-quarantined',
        seq: row.seq,
        error
      })
    );
  }
}
