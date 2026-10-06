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
export function chunkBytes(
  data: Uint8Array,
  size: number = SNAPSHOT_CHUNK_BYTES,
): Uint8Array[] {
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

  /** Creates the tables; records the schema version. Writes no update rows (TC-25). */
  migrate(): void {
    for (const statement of CREATE_TABLES) this.storage.sql.exec(statement);
    this.inject('load:meta');
    const version = this.meta(SCHEMA_VERSION_KEY);
    if (version === null) this.setMeta(SCHEMA_VERSION_KEY, String(STORAGE_SCHEMA_VERSION));
    const through = this.meta(SNAPSHOT_THROUGH_SEQ_KEY);
    this.throughSeq = through === null ? 0 : Number(through);
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
    const rows = [...this.storage.sql.exec('SELECT COUNT(*) AS count FROM snapshot_chunks')];
    return { chunks: Number(rows[0]?.count ?? 0), throughSeq: this.throughSeq };
  }

  /** How many changes could not be read and were set aside. */
  quarantinedCount(): number {
    const rows = [...this.storage.sql.exec('SELECT COUNT(*) AS count FROM quarantined_updates')];
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Writes one update down. Throws when the write fails — the room cannot afford to show
   * anybody a change it has not kept, and it is the room that decides what that means.
   */
  append(update: Uint8Array): void {
    this.inject('append');
    this.storage.sql.exec('INSERT INTO updates (data, bytes) VALUES (?1, ?2)', asBlob(update), update.length);
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
      this.migrate();
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
          return { ok: false, reason: 'snapshot-unreadable', error: describe(error) };
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
      console.error(JSON.stringify({ event: 'compaction-failed', stage: 'encode', error: describe(error) }));
      return false;
    }
    let maxSeq = 0;
    try {
      const rows = [...this.storage.sql.exec('SELECT MAX(seq) AS max_seq FROM updates')];
      maxSeq = Number(rows[0]?.max_seq ?? 0);
    } catch (error) {
      console.error(JSON.stringify({ event: 'compaction-failed', stage: 'max-seq', error: describe(error) }));
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
          this.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)', index, asBlob(chunk));
        });
        this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?1', maxSeq);
        this.inject('compact:after-log-delete');
        this.setMeta(SNAPSHOT_THROUGH_SEQ_KEY, String(maxSeq));
      });
    } catch (error) {
      // `transactionSync` has rolled all of it back: the old snapshot and every log row are
      // where they were. The board is still readable; it just keeps replaying a longer log.
      console.error(
        JSON.stringify({ event: 'compaction-failed', stage: 'transaction', error: describe(error) }),
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
      JSON.stringify({ event: 'update-quarantined', seq, bytes: data.length, error }),
    );
  }

  private meta(key: string): string | null {
    const rows = [...this.storage.sql.exec('SELECT value FROM storage_meta WHERE key = ?1', key)];
    return rows.length === 0 ? null : String(rows[0]?.value);
  }

  private setMeta(key: string, value: string): void {
    this.storage.sql.exec(UPSERT_META, key, value);
  }
}
