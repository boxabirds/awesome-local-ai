/**
 * A board's durable storage: one SQLite database per board, inside that board's Durable
 * Object.
 *
 * The shape is a log and a snapshot. Every change anybody makes is appended to `updates`
 * the moment it is applied (that is the whole of "it saves itself": there is nothing to
 * press), and once the log has grown past a threshold the room's document is re-encoded
 * into `snapshot_chunks` and the rows it already contains are deleted. A board is therefore
 * always rebuilt from at most one snapshot plus a few hundred rows, however long it has
 * been lived in — which is what lets a 2,000-note board open in seconds instead of
 * replaying every keystroke ever made on it.
 *
 * Three rules hold this together:
 *
 * - **Nothing is invented on a bad day.** A snapshot that cannot be read is reported to the
 *   caller, which refuses to serve an empty board as if it were the real one. A *log* row
 *   that cannot be read is moved to `quarantined_updates` and the rest of the board loads:
 *   one damaged change loses one change, not the board.
 * - **A change is written before it is shown.** That is the caller's job (`BoardRoom`), and
 *   it is why `append` rethrows: the room has to hear about a write that failed and must not
 *   tell anybody else about a change it has not kept.
 * - **Compaction is all one transaction or none of it.** `transactionSync` rolls the whole
 *   thing back, so a failure mid-compaction leaves the previous snapshot and the whole log
 *   exactly where they were.
 */

import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin of everything applied from storage. The room uses it to tell its own
 * reading-back from a change somebody made, so a load is never re-stored or re-broadcast.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** Where a board's load ended up. */
export type LoadResult =
  /** The board loaded; `quarantined` log rows could not be read and were set aside. */
  | { ok: true; quarantined: number }
  /** The board could not be loaded, so it must not be served — certainly not as an empty one. */
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** `storage_meta` keys this store owns. */
export const SCHEMA_VERSION_KEY = 'storage_schema_version';
export const SNAPSHOT_THROUGH_SEQ_KEY = 'snapshot_through_seq';
/**
 * When this board was created, in epoch milliseconds — the mark that says *this link belongs
 * to somebody*. Story 5 is what writes it: a board exists when it has a `created_at`, or when
 * it has content from before story 5 shipped and therefore never got one.
 */
export const CREATED_AT_KEY = 'created_at';

/** Every table this store owns, in the order they are created. */
export const TABLE_NAMES = [
  'storage_meta',
  'updates',
  'snapshot_chunks',
  'quarantined_updates',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

/**
 * Points inside this store where a test can make a statement fail, to see what the room
 * does with a storage that misbehaves (TC-11, TC-14, TC-26). Outside SQLite, so the real
 * transaction semantics still apply around the injected failure. Never set in production:
 * the default is a no-op.
 */
export type FaultPoint =
  | 'load:meta'
  | 'load:snapshot'
  | 'load:select-updates'
  | 'append'
  | 'compact:encode'
  | 'compact:after-chunk-delete'
  | 'compact:after-log-delete';

const CREATE_TABLES = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

const UPSERT_META =
  'INSERT INTO storage_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

/** Splits `data` into chunks of at most `size` bytes; empty input, empty list. */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got ${String(size)}`);
  }
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < data.length; start += size) {
    chunks.push(data.subarray(start, Math.min(start + size, data.length)));
  }
  return chunks;
}

/** The chunks back again, in order. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const joined = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

/** True when the log has grown enough to be worth folding into a snapshot. */
export function shouldCompact(
  count: number = 0,
  bytes: number = 0,
  countLimit: number = COMPACTION_UPDATE_COUNT,
  byteLimit: number = COMPACTION_BYTES,
): boolean {
  return count >= countLimit || bytes >= byteLimit;
}

/** A row's BLOB as bytes, whether the driver hands back an ArrayBuffer or a view. */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('expected a BLOB column');
}

/** The same bytes as an ArrayBuffer: what a BLOB parameter wants, exactly as long. */
function asBlob(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Reads a log row all the way through without letting it touch a document.
 *
 * This exists because Yjs does not apply an update in one go: it integrates struct by struct,
 * and a row that runs into an error half way through has already put the part it got to into
 * the document. Those leftovers then stand in for the real structures when the rows after them
 * are applied, so one unreadable row takes the rest of the log's content with it — a damaged
 * change would cost far more than the change it holds. Decoding is the half that fails on
 * nonsense, and it changes nothing, so a row is decoded first and only a row that decodes is
 * applied. A row that decodes but cannot be integrated is still caught here, and is still
 * counted and set aside.
 */
function readRow(update: Uint8Array): void {
  Y.decodeUpdate(update);
}

/**
 * The tables of one board. Every method is synchronous: the SQLite API inside a Durable
 * Object is, which is what lets the room write a change down in the same turn it applied it
 * and broadcast it in the next.
 */
export class BoardStore {
  /** Set by a test to fail a named statement; a no-op in production. */
  inject: (point: FaultPoint) => void = () => {};

  /** Log rows and bytes still to replay, kept in memory so appending costs one statement. */
  private rows = 0;
  private bytes = 0;
  /** Highest log row already folded into the snapshot. */
  private throughSeq = 0;

  constructor(private readonly storage: DurableObjectStorage) {}

  /**
   * Creates the tables; records the schema version. Writes no update rows (TC-25).
   *
   * Only two things call it: `BoardRoom.initialize()` (a board being created, through
   * `markCreatedAt()`) and this store's first `append()` (a board that predates the tables and
   * is being written to for the first time since). A *read* never creates tables — that is the
   * whole of story 5's "probing a link leaves nothing behind".
   */
  migrate(): void {
    for (const statement of CREATE_TABLES) this.storage.sql.exec(statement);
    this.tablesPresent = true;
    const version = this.meta(SCHEMA_VERSION_KEY);
    if (version === null) this.setMeta(SCHEMA_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
    const through = this.meta(SNAPSHOT_THROUGH_SEQ_KEY);
    this.throughSeq = through === null ? 0 : Number(through);
  }

  /**
   * True once this store knows its tables are there. `sqlite_master` is not free to ask and a
   * table this store has created this never goes away again, so the answer is kept.
   */
  private tablesPresent = false;

  /** Does this board have one named table? Reads `sqlite_master`; writes nothing. */
  tableExists(name: TableName): boolean {
    for (const _row of this.storage.sql.exec(
      'SELECT 1 AS present FROM sqlite_master WHERE type = ?1 AND name = ?2',
      'table',
      name,
    )) {
      return true;
    }
    return false;
  }

  /** Have this board's tables ever been created? */
  tablesExist(): boolean {
    if (this.tablesPresent) return true;
    let found = 0;
    for (const row of this.storage.sql.exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ?1 AND name IN (?2, ?3, ?4, ?5)',
      'table',
      TABLE_NAMES[0],
      TABLE_NAMES[1],
      TABLE_NAMES[2],
      TABLE_NAMES[3],
    )) {
      found = Number(row.count ?? 0);
    }
    if (found === TABLE_NAMES.length) this.tablesPresent = true;
    return this.tablesPresent;
  }

  /**
   * Is there a board here? Read-only in the strict sense: no `CREATE TABLE`, no `INSERT`, no
   * `migrate()` — a link that was guessed, mistyped or truncated is answered and left exactly
   * as empty as it was (share.not_found).
   *
   * Two things count as a board:
   *
   * - `storage_meta.created_at`, written once when the board is created; and
   * - any content at all — a log row or a snapshot chunk — which is every board that was
   *   already being used when links were introduced (share.legacy_boards). Those boards were
   *   never given a `created_at`, and there is no honest moment to retro-fit one.
   */
  existsReadOnly(): boolean {
    if (!this.tablesExist()) return false;
    if (this.meta(CREATED_AT_KEY) !== null) return true;
    return this.hasAnyRow('updates') || this.hasAnyRow('snapshot_chunks');
  }

  /** One row of this table, any row? */
  private hasAnyRow(table: TableName): boolean {
    if (!this.tableExists(table)) return false;
    for (const _row of this.storage.sql.exec(`SELECT 1 AS present FROM ${table} LIMIT 1`)) {
      return true;
    }
    return false;
  }

  /**
   * Marks this board as existing. True when this call is the one that created it, false when
   * it was already here — which is how `initialize()` answers a second call with `exists`
   * without touching anything that is already there (TC-15).
   */
  markCreatedAt(now: number = Date.now()): boolean {
    this.migrate();
    if (this.meta(CREATED_AT_KEY) !== null) return false;
    this.setMeta(CREATED_AT_KEY, String(now));
    return true;
  }

  /** When this board was created, as the text it is stored as; null when nothing says. */
  createdAt(): string | null {
    return this.meta(CREATED_AT_KEY);
  }

  /** This board's SQL, for the tests that damage a row or count one. */
  get sql(): DurableObjectStorage['sql'] {
    return this.storage.sql;
  }

  /** How much of the board is still in the log, for logging and for the tests. */
  get pendingRows(): number {
    return this.rows;
  }

  get pendingBytes(): number {
    return this.bytes;
  }

  /** Rows of snapshot the board has, and the log row it already contains. */
  snapshotInfo(): { chunks: number; throughSeq: number } {
    return {
      chunks: this.countRows('snapshot_chunks'),
      throughSeq: this.throughSeq,
    };
  }

  /** How many changes could not be read and were set aside. */
  quarantinedCount(): number {
    return this.countRows('quarantined_updates');
  }

  /** How many rows a table has; 0 when the table has not been created. */
  private countRows(table: TableName): number {
    if (!this.tableExists(table)) return 0;
    const rows = [
      ...this.storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`),
    ];
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Writes one update down. Throws when the write fails — the room cannot afford to show
   * anybody a change it has not kept, and it is the room that decides what that means.
   */
  append(update: Uint8Array): void {
    this.inject('append');
    // The write that creates a board's tables, if anything other than `initialize()` ever got
    // this far — which in practice means a board that had content before the tables existed.
    if (!this.tablesExist()) this.migrate();
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?1, ?2)',
      asBlob(update),
      update.length,
    );
    this.rows += 1;
    this.bytes += update.length;
  }

  /**
   * Reads the board into `doc`: the snapshot first, then every log row after it, oldest
   * first. A log row Yjs cannot read is moved to `quarantined_updates` and counted, and the
   * board loads anyway; a snapshot Yjs cannot read — or a database that cannot be read at
   * all — is `ok: false`, and nothing at all is deleted or set aside on the way out.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Missing tables are an empty board, not a board to create. Story 4 could afford to
      // `migrate()` on the way in, because everything that reached this point had been asked
      // for by name through a room that was being joined. Story 5 asks about boards by link
      // instead, and a question must not leave an answer behind: an unknown id is read, found
      // to be empty and left with nothing in `sqlite_master`.
      if (!this.tablesExist()) {
        this.rows = 0;
        this.bytes = 0;
        this.throughSeq = 0;
        return { ok: true, quarantined: 0 };
      }
      // Reading what the board already contains starts with reading the record of how far the
      // snapshot got. A database that will not answer that is a database that cannot be read,
      // and the room finds out here rather than half-way through a board.
      this.inject('load:meta');
      this.throughSeq = Number(this.meta(SNAPSHOT_THROUGH_SEQ_KEY) ?? '0');
      this.inject('load:snapshot');
      const chunks: Uint8Array[] = [];
      for (const row of this.storage.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx')) {
        chunks.push(asBytes(row.data));
      }
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (error) {
          // The bulk of the board is unreadable. The snapshot stays where it is — damaged,
          // but ours — and the caller refuses to serve the board.
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: describe(error),
          };
        }
      }

      this.inject('load:select-updates');
      const rows = [
        ...this.storage.sql.exec(
          'SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq',
          this.throughSeq,
        ),
      ];
      let quarantined = 0;
      let kept = 0;
      let keptBytes = 0;
      for (const row of rows) {
        const seq = Number(row.seq);
        const data = asBytes(row.data);
        const size = Number(row.bytes);
        try {
          readRow(data);
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          kept += 1;
          keptBytes += size;
        } catch (error) {
          this.quarantine(seq, data, describe(error));
          quarantined += 1;
        }
      }
      this.rows = kept;
      this.bytes = keptBytes;
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describe(error) };
    }
  }

  /**
   * Folds the log into a new snapshot when it has grown enough. Never throws: a compaction
   * that fails has simply not happened, the log is still there and the board still loads —
   * the next change gives it another go.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.rows, this.bytes)) return false;
    return this.compactNow(doc);
  }

  /**
   * Folds the log into a snapshot now, whether or not it has grown enough.
   *
   * The product never calls this: `compactIfNeeded` is the one that decides, on the thresholds
   * in the config. It exists because a test cannot wait for five hundred rows by clicking, and
   * because the fold is the only thing that puts anything into the snapshot table — which is the
   * table the damaged-board case has to have something in to damage.
   */
  compactNow(doc: Y.Doc): boolean {
    let snapshot: Uint8Array;
    try {
      this.inject('compact:encode');
      // The in-memory document already holds snapshot plus log, so this one encoding is the
      // whole board, and Yjs has dropped everything deleted along the way.
      snapshot = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          stage: 'encode',
          error: describe(error),
        }),
      );
      return false;
    }
    let maxSeq = 0;
    try {
      const rows = [...this.storage.sql.exec('SELECT MAX(seq) AS max_seq FROM updates')];
      maxSeq = Number(rows[0]?.max_seq ?? 0);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          stage: 'max-seq',
          error: describe(error),
        }),
      );
      return false;
    }
    if (maxSeq === 0) {
      // Nothing to fold: forget the counters and carry on.
      this.rows = 0;
      this.bytes = 0;
      return false;
    }
    const chunks = chunkBytes(snapshot);
    try {
      this.storage.transactionSync(() => {
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        this.inject('compact:after-chunk-delete');
        chunks.forEach((chunk, index) => {
          this.storage.sql.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)',
            index,
            asBlob(chunk),
          );
        });
        this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?1', maxSeq);
        this.inject('compact:after-log-delete');
        this.setMeta(SNAPSHOT_THROUGH_SEQ_KEY, String(maxSeq));
      });
    } catch (error) {
      // `transactionSync` has rolled all of it back: the old snapshot and every log row are
      // where they were. The board is still readable; it just keeps replaying a longer log.
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          stage: 'transaction',
          error: describe(error),
        }),
      );
      return false;
    }
    this.throughSeq = maxSeq;
    this.rows = 0;
    this.bytes = 0;
    return true;
  }

  /** Moves a log row we cannot read out of the log and into the record of what was lost. */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)',
        seq,
        asBlob(data),
        error,
        Date.now(),
      );
      this.storage.sql.exec('DELETE FROM updates WHERE seq = ?1', seq);
    });
    console.error(
      JSON.stringify({
        event: 'update-quarantined',
        seq,
        bytes: data.length,
        error,
      }),
    );
  }

  private meta(key: string): string | null {
    if (!this.tableExists('storage_meta')) return null;
    const rows = [...this.storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?1', key)];
    return rows.length === 0 ? null : String(rows[0]?.value);
  }

  private setMeta(key: string, value: string): void {
    this.storage.sql.exec(UPSERT_META, key, value);
  }
}
