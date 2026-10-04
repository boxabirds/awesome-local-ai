import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Everything one board keeps in its Durable Object's SQLite storage.
 *
 * A board is stored as it happens: one row per Yjs update, in the order they were made, and
 * from time to time that log of updates is folded into a snapshot of the whole document, so
 * that loading a board that has been worked on for months does not mean replaying every
 * keystroke and drag frame ever made. The snapshot is kept in chunks, each of them
 * comfortably smaller than the per-row size limit of SQLite-backed Durable Objects.
 *
 * ```text
 * storage_meta        key/value: storage_schema_version, snapshot_through_seq
 * updates             seq, data, bytes      the log, one row per Yjs update, in order
 * snapshot_chunks     idx, data             the snapshot, in order
 * quarantined_updates seq, data, error, …   log rows that would not load, set aside
 * ```
 *
 * What this module never does is decide what a person sees. `load` reports what it could not
 * read; the room decides what to say about it (see `board-room.ts`), which is what keeps a
 * board that will not load from being shown as an empty one.
 *
 * Every statement here is synchronous, which is what lets the room write an update before it
 * passes it on (persist.seen_is_saved) in the same turn it applied it.
 */

/** What {@link BoardStore.load} ended up doing. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * The origin of every update the store applies while loading.
 *
 * It is how the room tells a byte it read back from its own storage from a change somebody
 * made: the first is already stored and needs nobody else to hear it, the second is neither.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** Keys of the `storage_meta` table. */
const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';
/**
 * When this board was created, in epoch milliseconds: the mark {@link BoardStore.markCreated}
 * writes once, and the thing that says a link belongs to a board (share.not_found). A board
 * stored before story 5 has no such row and still exists, by its content alone - see
 * {@link BoardStore.existsReadOnly}.
 */
const META_CREATED_AT = 'created_at';

/** The store's own tables, named because "does this address have a board?" asks for them. */
const TABLE_META = 'storage_meta';
const TABLE_UPDATES = 'updates';
const TABLE_CHUNKS = 'snapshot_chunks';

/**
 * The points inside the store's own work where something can be made to fail.
 *
 * A disk that gives out cannot be scheduled on demand, so a test asks for the failure at a
 * named point instead. It is thrown from outside SQLite - the statement itself is left alone,
 * which is what keeps a failed compaction a real rollback rather than a simulated one. The
 * room hands its store a controller that never fires unless a test armed it (see
 * `store-faults.ts`).
 */
export type StoreStep =
  | 'append'
  | 'load:read-snapshot'
  | 'load:read-log'
  | 'load:quarantine'
  | 'compact:delete-chunks'
  | 'compact:write-chunks'
  | 'compact:truncate-log'
  | 'compact:write-meta';

/** Something that may refuse to let a named point happen. */
export interface StoreFaults {
  /** Throws to make the work named by `step` fail. */
  hit(step: StoreStep): void;
}

/** The controller a store has when nobody is trying to break it. */
export const NO_FAULTS: StoreFaults = {
  hit(): void {
    // Nothing is armed; every point is allowed through.
  },
};

/** One row of the `quarantined_updates` table. */
interface QuarantinedRow {
  seq: number;
  data: Uint8Array;
  error: string;
  quarantinedAt: number;
}

/**
 * Split `data` into chunks of at most `size` bytes, in order.
 *
 * Nothing in, nothing out: 0 bytes are 0 chunks rather than one empty one, because a stored
 * empty chunk would be a row that says "there is a snapshot" about a board that has none.
 */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive whole number, got ${size}`);
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    // A copy rather than a view, so a chunk does not hold the whole snapshot alive and
    // compares as itself wherever it turns up later.
    chunks.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** Put chunks back together, byte for byte, in the order they are given. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * True when a log of `count` rows totalling `bytes` is worth folding into a snapshot.
 *
 * Either half is enough: 500 small updates is a lot of replay for a board that is a few
 * kilobytes, and 4 MB of them is a lot of rows to read back whatever their number.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** SQLite-backed Durable Objects hand BLOBs back as `ArrayBuffer`. */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  throw new TypeError(`expected a BLOB column, got ${Object.prototype.toString.call(value)}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether Yjs is holding changes back because a struct they depend on never arrived.
 *
 * This happens when a log row cannot be read and the rows behind it carry later changes from
 * the same person's client: Yjs will not apply changes across a hole in one client's run of
 * changes, so whatever is behind the hole stays invisible however carefully it is applied
 * again. It is not a bug this file can fix - the missing bytes are gone - but it is something
 * the room has to know, because it decides how much of a board a single damaged row costs.
 */
export function isHoldingContentBack(doc: Y.Doc): boolean {
  return doc.store.pendingStructs !== undefined;
}

/** One row of the log, read into memory so the database is not written to mid-scan. */
interface LogRow {
  seq: number;
  data: Uint8Array;
  bytes: number;
}

/**
 * One board's stored state, in one board's Durable Object.
 *
 * The row count and byte total are kept in memory between writes - a `COUNT(*)` before every
 * update would cost more than the update itself - which is why {@link BoardStore.load} fills
 * them in, and why a room reads its board through the same store instance it writes with.
 */
export class BoardStore {
  private readonly sql: SqlStorage;
  private readonly faults: StoreFaults;
  /** Highest log row ever written here (0 for a board with no log). */
  private maxSeq = 0;
  /** Log rows above {@link throughSeq}, and their bytes. */
  private rows = 0;
  private bytes = 0;
  /** The log row the snapshot was taken at: everything up to it is already in the snapshot. */
  private throughSeq = 0;
  /**
   * What the store wants the room to know about storage.
   *
   * The room logs this; the store does not decide what a log line looks like, and a test can
   * listen without a console in the way.
   */
  private readonly note: (message: string) => void;

  /**
   * True once this instance knows the tables are there, so the log does not ask for them
   * before every one of thousands of appends. Only ever set from {@link migrate} and
   * {@link load}, both of which have just looked.
   */
  private tablesWritten = false;

  constructor(
    private readonly storage: DurableObjectStorage,
    options: { faults?: StoreFaults; note?: (message: string) => void } = {},
  ) {
    this.storage = storage;
    this.sql = storage.sql;
    this.faults = options.faults ?? NO_FAULTS;
    this.note = options.note ?? (() => {});
  }

  /**
   * Create the tables and record which version of them this is.
   *
   * A board that was never written to is left with nothing but the tables: opening it must
   * not put rows in storage that say it was edited (TC-25).
   */
  migrate(): void {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS updates (' +
        'seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (' +
        'seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
    );
    this.sql.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)`,
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
    this.tablesWritten = true;
  }

  /**
   * Write the one row that says this address is a board, and say whether it was already.
   *
   * This is the moment a board begins: {@link createBoard} generates an id and calls it, and
   * from then on every route agrees the link leads somewhere. It is written once and never
   * again, which is what lets {@link initialize} answer `exists` the second time instead of
   * starting a second board over the top of the first (TC-15).
   */
  markCreated(): 'created' | 'exists' {
    this.migrate();
    if (this.createdAt() !== null) {
      return 'exists';
    }
    this.sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
      META_CREATED_AT,
      String(Date.now()),
    );
    return 'created';
  }

  /**
   * Whether a board is stored here, reading and writing nothing.
   *
   * Two things make a board exist: the creation date {@link markCreated} writes, and - for a
   * board that predates that row (share.legacy_boards) - a log row or a snapshot chunk, since
   * nothing else could have put one there. The first question is asked of `sqlite_master`, so
   * that a link typed at random is answered "no board here" without this call having created
   * the tables it is asking about: a probe of an unknown link has to leave the address exactly
   * as it found it (TC-06, TC-09), which is also why a board is not created by connecting to it.
   *
   * It does not swallow a storage error: a database that cannot be read is not a database with
   * no board in it, and the caller would rather say "could not reach vidi6" than "board not
   * found".
   */
  existsReadOnly(): boolean {
    if (this.createdAt() !== null) {
      return true;
    }
    // A board saved before this row existed is a board all the same: it has content.
    return this.hasRow(TABLE_UPDATES) || this.hasRow(TABLE_CHUNKS);
  }

  /** The creation date, or null when this address has never been created as a board. */
  private createdAt(): number | null {
    if (!this.hasTable(TABLE_META)) {
      return null;
    }
    for (const row of this.sql.exec(
      'SELECT value FROM storage_meta WHERE key = ?',
      META_CREATED_AT,
    )) {
      const at = Number(row.value);
      return Number.isFinite(at) && at > 0 ? at : null;
    }
    return null;
  }

  /** Table names this storage holds right now - read fresh, because a test may have just made one. */
  private hasTable(name: string): boolean {
    for (const row of this.sql.exec(
      "SELECT 1 AS here FROM sqlite_master WHERE type = 'table' AND name = ?",
      name,
    )) {
      return row.here === 1;
    }
    return false;
  }

  /** True when the table is there and holds at least one row; a missing table holds nothing. */
  private hasRow(table: string): boolean {
    if (!this.hasTable(table)) {
      return false;
    }
    for (const row of this.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`)) {
      return Number(row.n) > 0;
    }
    return false;
  }

  /**
   * Add one applied update to the end of the log.
   *
   * The row is written here, synchronously, before the room passes the change on to anybody
   * else - and a change whose row cannot be written is not passed on at all (persist.automatic
   * and persist.seen_is_saved are the two halves of the same statement). Errors are rethrown
   * for the room to deal with.
   */
  append(update: Uint8Array): void {
    this.faults.hit('append');
    // Story 5 moved the tables off the room's constructor, because creating them is how an
    // address becomes a board. A board that gets this far exists - a connection to one that
    // does not is refused before the room relays anything - so making sure they are here costs
    // one remembered flag, not a query per change.
    if (!this.tablesWritten) {
      this.migrate();
    }
    for (const row of this.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?) RETURNING seq',
      update,
      update.byteLength,
    )) {
      this.maxSeq = Number(row.seq);
    }
    this.rows += 1;
    this.bytes += update.byteLength;
  }

  /**
   * Read the saved board back into `doc`: the snapshot first, then the log on top of it.
   *
   * A log row that will not load is moved to `quarantined_updates` and the rest carry on
   * (persist.partial_damage), so one damaged change costs one change. A snapshot that will
   * not load is a different thing: the bulk of the board is unreadable, so the result says so
   * rather than handing back a document that happens to be empty (persist.load_failure), and
   * nothing at all is deleted or set aside while trying.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      this.faults.hit('load:read-snapshot');
      if (!this.hasTable(TABLE_UPDATES) && !this.hasTable(TABLE_CHUNKS) && !this.hasTable(TABLE_META)) {
        // Nothing has ever been written at this address, which is an empty board rather than a
        // broken one - and it stays that way: reading a board that is not there must not put
        // tables in, or every mistyped link would leave a board behind it (share.not_found).
        this.throughSeq = 0;
        this.rows = 0;
        this.bytes = 0;
        return { ok: true, quarantined: 0 };
      }
      // A board that has some of these tables but not others came from an earlier version of
      // this file; `migrate` is `CREATE TABLE IF NOT EXISTS`, so this fills in what is missing
      // and leaves what is there alone.
      this.migrate();
      const chunks: Uint8Array[] = [];
      for (const row of this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx')) {
        chunks.push(asBytes(row.data));
      }
      this.throughSeq = this.metaNumber(META_SNAPSHOT_THROUGH);
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (error) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: describeError(error),
          };
        }
      }

      this.faults.hit('load:read-log');
      const rows: LogRow[] = [];
      for (const row of this.sql.exec(
        'SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq',
        this.throughSeq,
      )) {
        const data = asBytes(row.data);
        rows.push({ seq: Number(row.seq), data, bytes: Number(row.bytes) });
      }
      this.maxSeq = Math.max(this.maxSeq, this.throughSeq);

      this.rows = 0;
      this.bytes = 0;
      let quarantined = 0;
      for (const row of rows) {
        this.maxSeq = Math.max(this.maxSeq, row.seq);
        try {
          Y.applyUpdate(doc, row.data, LOAD_ORIGIN);
        } catch (error) {
          this.quarantine({
            seq: row.seq,
            data: row.data,
            error: describeError(error),
            quarantinedAt: Date.now(),
          });
          quarantined += 1;
          // Named with its row number, which is how a person finds the change again; see
          // TC-15, where a room logs exactly this.
          this.note(
            `update row ${row.seq} (${row.bytes} bytes) could not be read and was set aside: ${describeError(error)}`,
          );
          continue;
        }
        this.rows += 1;
        this.bytes += row.bytes;
      }
      if (quarantined > 0 && isHoldingContentBack(doc)) {
        // Say it out loud, because it is the worst kind of damage: the board opens, and some of
        // it is quietly not there. The bytes behind the hole are gone with the damaged row, so
        // there is nothing to retry; what this row number buys is the ability to answer a
        // person's question about a note that went missing.
        this.note(
          `board is short of content: ${quarantined} damaged row(s) left later changes from the same client unread`,
        );
      }
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describeError(error) };
    }
  }

  /**
   * Fold the log into a snapshot if it has grown enough. Never throws.
   *
   * `doc` is the room's live document, which already holds the snapshot this replaces plus
   * every row being deleted, so the new snapshot is one `encodeStateAsUpdate` away. The whole
   * fold is one transaction: if any of it fails, the old chunks and the whole log come back
   * and the board loads the same way tomorrow as it does today.
   *
   * `force` is for the test-only storage route, which has to be able to look at a snapshot of
   * a board it just made; the room itself never passes it.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.rows, this.bytes)) {
      return false;
    }
    let chunks: Uint8Array[];
    try {
      chunks = chunkBytes(Y.encodeStateAsUpdate(doc), SNAPSHOT_CHUNK_BYTES);
    } catch (error) {
      this.note(`compaction could not encode the board: ${describeError(error)}`);
      return false;
    }

    let throughSeq = this.throughSeq;
    try {
      this.storage.transactionSync(() => {
        this.faults.hit('compact:delete-chunks');
        this.sql.exec('DELETE FROM snapshot_chunks');
        this.faults.hit('compact:write-chunks');
        for (const [index, chunk] of chunks.entries()) {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index, chunk);
        }
        this.faults.hit('compact:truncate-log');
        // Asked of the database rather than taken from memory: the bound that decides what is
        // safe to delete should not come from a number this instance has been keeping.
        for (const row of this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM updates')) {
          throughSeq = Math.max(throughSeq, Number(row.seq));
        }
        this.sql.exec('DELETE FROM updates WHERE seq <= ?', throughSeq);
        this.faults.hit('compact:write-meta');
        this.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)`,
          META_SNAPSHOT_THROUGH,
          String(throughSeq),
        );
      });
    } catch (error) {
      // Rolled back by `transactionSync`: the previous snapshot and the whole log are intact.
      this.note(
        `compaction failed after ${chunks.length} chunk(s) and was rolled back: ${describeError(error)}`,
      );
      return false;
    }

    this.throughSeq = throughSeq;
    this.rows = 0;
    this.bytes = 0;
    return true;
  }

  /** The version of these tables, as recorded by {@link migrate}. */
  schemaVersion(): number {
    return this.metaNumber(META_SCHEMA_VERSION);
  }

  /** How many log rows and how many bytes are currently stored above the snapshot. */
  counts(): { rows: number; bytes: number; throughSeq: number } {
    return { rows: this.rows, bytes: this.bytes, throughSeq: this.throughSeq };
  }

  /** Move one unreadable log row aside, where it can be looked at but never loaded again. */
  private quarantine(row: QuarantinedRow): void {
    this.faults.hit('load:quarantine');
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM updates WHERE seq = ?', row.seq);
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        row.seq,
        row.data,
        row.error,
        row.quarantinedAt,
      );
    });
    this.rows = Math.max(0, this.rows - 1);
  }

  private metaNumber(key: string): number {
    for (const row of this.sql.exec('SELECT value FROM storage_meta WHERE key = ?', key)) {
      const value = Number(row.value);
      return Number.isFinite(value) ? value : 0;
    }
    return 0;
  }
}
