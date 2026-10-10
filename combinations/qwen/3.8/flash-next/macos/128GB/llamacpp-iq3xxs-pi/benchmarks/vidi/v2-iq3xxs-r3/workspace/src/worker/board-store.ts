/**
 * Where one board's saved state lives (persist.board_store): the SQLite storage
 * of the board's own Durable Object.
 *
 * The layout is the design's: a small `storage_meta` table, an append-only log
 * of Yjs updates, a snapshot split into chunk rows, and a table for the rare
 * log row that refuses to be read again.
 *
 * Two things about this file are load-bearing. First, everything in it is
 * synchronous: it is called inside `transactionSync` and inside Durable Object
 * turns that must not be interleaved, and a read in the middle of a write is
 * how "the board looked different to the second pair" comes back. Second, no
 * method here decides what the product does when storage fails — that is the
 * room's job; the store only reports honestly.
 */
import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Transaction origin for bytes coming *out of* storage. Without it, reloading a
 * board would look like a change this room just received: it would be stored
 * again and broadcast to sockets that are not even open yet.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/**
 * What reading a board ended as. `ok: false` never means "empty": the room
 * refuses to serve an unreadable board as a blank one (persist.load_failure).
 */
export type LoadResult =
  | { ok: true; quarantined: number }
  | {
      ok: false;
      reason: 'snapshot-unreadable' | 'log-unreadable' | 'sql-error';
      error: string;
      /** Set when the unreadable row itself was recorded in `quarantined_updates`. */
      quarantined?: number;
    };

/** `storage_meta` keys. `snapshot_through_seq` is how far the snapshot got. */
const META_STORAGE_VERSION = 'storageSchemaVersion';
const META_SNAPSHOT_THROUGH_SEQ = 'snapshotThroughSeq';
/**
 * When this board was made (share.board_api). `initialize()` writes it once and
 * it is the primary answer to "does this link lead to a board?";
 * share.legacy_boards covers the boards that predate it and are recognised by
 * their data instead.
 */
const META_CREATED_AT = 'created_at';

/**
 * The comment every statement of the existence question carries. Asking *whether*
 * a board is at an address is not reading the board, and the two must stay
 * tellable apart — by the store, and by the test that counts reads against the
 * reconnect interval (story 4's TC-16).
 */
const EXISTS_PROBE = '/* board: exists? */';

/** The tables, as `sqlite_master` names them. */
const TABLE_STORAGE_META = 'storage_meta';
const TABLE_UPDATES = 'updates';
const TABLE_SNAPSHOT_CHUNKS = 'snapshot_chunks';

/**
 * The tables, each with an explicit row size in mind: one logged update, one
 * snapshot chunk, one quarantined row. `seq` is monotonic, so "everything after
 * the snapshot" is one indexed query, and a quarantined row keeps its `seq` so
 * the gap it left is visible when a board is being investigated.
 */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS storage_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS updates (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     bytes INTEGER NOT NULL,
     data BLOB NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS snapshot_chunks (
     idx INTEGER PRIMARY KEY,
     bytes INTEGER NOT NULL,
     data BLOB NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS quarantined_updates (
     seq INTEGER PRIMARY KEY,
     bytes INTEGER NOT NULL,
     data BLOB NOT NULL,
     error TEXT NOT NULL,
     quarantined_at TEXT NOT NULL
   )`,
];

/**
 * Split `data` into at most `size`-byte rows (persist.board_store): storage
 * likes small rows, and a big board's snapshot must not become one huge one.
 * The pieces are copies, so a chunk stays valid if the caller's buffer is
 * reused by the next encode.
 */
export function chunkBytes(
  data: Uint8Array,
  size: number = SNAPSHOT_CHUNK_BYTES,
): Uint8Array[] {
  if (size < 1) throw new Error(`chunk size must be positive, got ${size}`);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    const end = Math.min(offset + size, data.byteLength);
    const chunk = new Uint8Array(end - offset);
    chunk.set(data.subarray(offset, end));
    chunks.push(chunk);
  }
  return chunks;
}

/** The inverse of `chunkBytes`, in order. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * True when the log has grown enough to be worth folding into a snapshot.
 * Either threshold is enough: a board of many small edits hits the row count,
 * a board of rare but huge ones the byte total.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/** SQLite bindings cannot take a `Uint8Array` view; they want an `ArrayBuffer`. */
function toBlob(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/** A `BLOB` column comes back as a `Uint8Array` (or the buffer underneath it). */
function asBlob(value: SqlStorageValue): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`expected a BLOB, got ${value === null ? 'NULL' : typeof value}`);
}

/** Something the log could not read, in a form worth a log line. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * One board's storage. Every method is synchronous, like the SQL API it uses;
 * `append` is called in the same turn as the update it stores, before anything
 * is broadcast (persist.seen_is_saved).
 */
export class BoardStore {
  /** Logged rows and their bytes, so a threshold check costs nothing. */
  #rows = 0;
  #bytes = 0;
  /** Highest `seq` the snapshot already contains; the log starts after it. */
  #throughSeq = 0;

  constructor(readonly storage: DurableObjectStorage) {}

  /**
   * Create the tables if needed, and record the storage version. Writes no
   * update rows and no snapshot (TC-25): opening a board that was never edited
   * must not make it "have something".
   */
  migrate(): void {
    this.storage.transactionSync(() => {
      this.#ensureSchema();
    });
  }

  /**
   * Claim this address as a board (share.board_api): the tables, and one
   * `created_at` row saying when this board started — written once, and never
   * again by somebody asking a second time (TC-15).
   *
   * A board that already has data but predates `created_at` (share.legacy_boards)
   * is reported as what it is — `exists` — and merely gains the metadata row it
   * never had, because "this address holds a board" is allowed one answer.
   */
  initialize(): 'created' | 'exists' {
    // Asked before anything is written, so the answer is about the board that
    // was here before this call, not about the tables this call makes.
    const alreadyABoard = this.existsReadOnly();
    let created = false;
    this.storage.transactionSync(() => {
      this.#ensureSchema();
      if (this.#metaValue(META_CREATED_AT) === undefined) {
        this.#setMeta(META_CREATED_AT, String(Date.now()));
        // A legacy board keeps its history: it already existed, whatever this
        // call adds to its metadata.
        created = !alreadyABoard;
      }
    });
    return created ? 'created' : 'exists';
  }

  /**
   * Does this address hold a board? (share.not_found, share.legacy_boards)
   *
   * Read-only, and emphatically so: this answers the question a stranger asks by
   * pasting a made-up link, and a probe that left a table behind would turn
   * every typo ever made into a board (TC-06, TC-09). `sqlite_master` is asked
   * first for exactly that reason — a stranger's link costs one query and no
   * writes at all.
   */
  existsReadOnly(): boolean {
    // Every statement below carries `board: exists?`. Not for a human reading a
    // query log (though they may): story 4's test that counts *board reads* on
    // behalf of a reconnecting client has to tell "is there a board here?" apart
    // from "what is on the board", because only the second one is a read.
    const probe = (sql: string): boolean =>
      this.#sql.exec(`${sql} ${EXISTS_PROBE}`).toArray().length > 0;
    const tables = this.#tableNames(EXISTS_PROBE);
    // Never written: the ordinary answer for a made-up link, and one statement
    // to give it.
    if (tables.size === 0) return false;
    const created = `SELECT 1 FROM storage_meta WHERE key = '${META_CREATED_AT}' LIMIT 1`;
    if (tables.has(TABLE_STORAGE_META) && probe(created)) return true;
    // Legacy: content but no `created_at`, i.e. a board from before this feature
    // existed, which keeps working at its old address.
    for (const table of [TABLE_UPDATES, TABLE_SNAPSHOT_CHUNKS]) {
      if (!tables.has(table)) continue;
      if (probe(`SELECT 1 FROM ${table} LIMIT 1`)) return true;
    }
    return false;
  }

  /**
   * Add one Yjs update to the log. The insert is its own transaction and SQL
   * errors rethrow: the room resets itself and keeps everyone off it until it
   * comes back with the board from storage (persist.save_failure).
   */
  append(update: Uint8Array): void {
    const bytes = update.byteLength;
    this.storage.transactionSync(() => {
      // Story 5: the tables are no longer created when a board is *read*, so the
      // first change a board makes creates them instead. A legacy board already
      // has them, and the check is one lookup in `sqlite_master`.
      this.#ensureSchema();
      this.#sql.exec('INSERT INTO updates (bytes, data) VALUES (?, ?)', bytes, toBlob(update));
    });
    // Only counted once it is really there.
    this.#rows += 1;
    this.#bytes += bytes;
  }

  /**
   * Apply everything saved to `doc`: the snapshot first, then the logged
   * updates oldest first. Never throws; the result says what happened.
   *
   * A snapshot that cannot be read is not a board with a hole in it — it is a
   * board that cannot be read, and nothing is applied or deleted.
   *
   * A log row that Yjs cannot read stops the read, and the room refuses to open
   * the board. Skipping it would not "lose one change": every update a board
   * writes comes from one client's clock, and an update whose clock range is
   * missing is held by Yjs as not-yet-applicable — so are all the ones after
   * it. Measured: log 30 rows, refuse to apply row 3, and the board comes back
   * with 1 note of 25 (it jumps back to 25 as soon as row 3 is applied again).
   * A board missing 24 notes because of one bad row, with nothing on screen to
   * say so, is the failure this story exists to prevent, so the read fails
   * instead — loudly, and the same way on every retry.
   *
   * The unreadable row is *copied* to `quarantined_updates` with its error and
   * left in the log: deleting it would leave a hole whose loads quietly
   * succeed with the tail gone.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Nothing has ever been written to this address: an empty board, reached
      // without creating a single table. Board creation (`initialize`) and the
      // first change (`append`) are what make tables now (share.not_found).
      if (!this.#hasSchema()) {
        this.#rows = 0;
        this.#bytes = 0;
        this.#throughSeq = 0;
        return { ok: true, quarantined: 0 };
      }
      const snapshot = this.#readSnapshot();
      if (snapshot.byteLength > 0) {
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          // Deliberately leaves the log alone: TC-10's negative is that a
          // failed read quarantines nothing.
          return { ok: false, reason: 'snapshot-unreadable', error: describeError(error) };
        }
      }

      const through = this.#snapshotThroughSeq();
      const rows = this.#sql
        .exec(
          'SELECT seq, bytes, data FROM updates WHERE seq > ? ORDER BY seq ASC',
          through,
        )
        .toArray();

      let applied = 0;
      let appliedBytes = 0;
      let lastSeq = through;
      for (const row of rows) {
        const seq = Number(row.seq);
        try {
          Y.applyUpdate(doc, asBlob(row.data), LOAD_ORIGIN);
        } catch (error) {
          // Recorded for whoever has to fix the board, then stop: the rows
          // after this one would not apply either.
          const reason = describeError(error);
          this.#quarantine(seq, reason);
          return {
            ok: false,
            reason: 'log-unreadable',
            error: `seq=${seq}: ${reason}`,
            quarantined: 1,
          };
        }
        applied += 1;
        appliedBytes += Number(row.bytes);
        lastSeq = seq;
      }

      this.#rows = applied;
      this.#bytes = appliedBytes;
      this.#throughSeq = lastSeq;
      // Reaching the end of the log without a bad row is the only way here, so
      // there is nothing to report.
      return { ok: true, quarantined: 0 };
    } catch (error) {
      // Reading storage itself failed, which is not the board's fault.
      return { ok: false, reason: 'sql-error', error: describeError(error) };
    }
  }

  /**
   * Fold the logged updates into a snapshot when they are worth folding
   * (persist.board_store). One transaction, so a compaction either happens
   * fully or leaves the log alone — a rolled-back compaction losing the log
   * would be the data loss this whole story is trying to avoid.
   *
   * Never throws: `false` means "not folded" (nothing to do, or an error that
   * was logged), and the log is still there to try again with.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.#rows, this.#bytes)) return false;

    let snapshot: Uint8Array;
    try {
      snapshot = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      console.error(`board snapshot failed: ${describeError(error)}`);
      return false;
    }
    const chunks = chunkBytes(snapshot);
    const maxSeq = Number(
      this.#sql.exec('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM updates').one().max_seq,
    );

    try {
      this.storage.transactionSync(() => {
        this.#sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, idx) => {
          this.#sql.exec(
            'INSERT INTO snapshot_chunks (idx, bytes, data) VALUES (?, ?, ?)',
            idx,
            chunk.byteLength,
            toBlob(chunk),
          );
        });
        this.#sql.exec('DELETE FROM updates');
        this.#setMeta(META_SNAPSHOT_THROUGH_SEQ, String(Math.max(this.#throughSeq, maxSeq)));
      });
    } catch (error) {
      // Rolled back: the log is intact, the counters are untouched, so the next
      // change tries again.
      console.error(`board compaction failed and was rolled back: ${describeError(error)}`);
      return false;
    }

    this.#throughSeq = Math.max(this.#throughSeq, maxSeq);
    this.#rows = 0;
    this.#bytes = 0;
    return true;
  }

  /** The snapshot, in chunk order. Empty when there is not one (yet). */
  /**
   * Whether the log has grown enough to be worth folding. The room asks this
   * before it claims to be `compacting`: below the threshold there is nothing
   * to fold and no phase to move through.
   */
  compactionDue(): boolean {
    return shouldCompact(this.#rows, this.#bytes);
  }

  #readSnapshot(): Uint8Array {
    const rows = this.#sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC').toArray();
    return joinChunks(rows.map((row) => asBlob(row.data)));
  }

  /**
   * Record one unreadable log row (bytes and all) in `quarantined_updates`, in
   * its own transaction so the failure of the recording cannot be what loses
   * the read. Idempotent: the same row is reported again on every retry.
   */
  #quarantine(seq: number, error: string): void {
    this.storage.transactionSync(() => {
      this.#sql.exec(
        `INSERT OR REPLACE INTO quarantined_updates (seq, bytes, data, error, quarantined_at)
         SELECT seq, bytes, data, ?, datetime('now') FROM updates WHERE seq = ?`,
        error,
        seq,
      );
    });
    // Log lines from this room all start the same way, so the board can be
    // found from the message.
    console.error(`board update quarantined: seq=${seq} ${error}`);
  }

  /**
   * Which tables this board's storage has right now. `via` labels the statement
   * for the caller's benefit (see `existsReadOnly`).
   */
  #tableNames(via?: string): Set<string> {
    const sql = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
    const rows = this.#sql.exec(via === undefined ? sql : `${sql} ${via}`).toArray();
    return new Set(rows.map((row) => String(row.name)));
  }

  /**
   * The minimum a board's storage has to hold to be a board at all: its meta and
   * its log. A snapshot without those two cannot exist, and a stranger's probe
   * never gets here.
   */
  #hasSchema(): boolean {
    const tables = this.#tableNames();
    return tables.has(TABLE_STORAGE_META) && tables.has(TABLE_UPDATES);
  }

  /**
   * Create the schema if it is missing. Called from `migrate` (which is
   * `initialize`), from `append` and from the test hook — never from a read.
   * It runs inside the caller's transaction, which is what makes "the tables and
   * the first row of the board" one atomic fact.
   */
  #ensureSchema(): void {
    for (const statement of SCHEMA_STATEMENTS) this.#sql.exec(statement);
    if (this.#metaValue(META_STORAGE_VERSION) === undefined) {
      this.#setMeta(META_STORAGE_VERSION, String(STORAGE_SCHEMA_VERSION));
    }
  }

  #snapshotThroughSeq(): number {
    const stored = this.#metaValue(META_SNAPSHOT_THROUGH_SEQ);
    const parsed = stored === undefined ? 0 : Number(stored);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  #metaValue(key: string): string | undefined {
    const row = this.#sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', key)
      .toArray()[0];
    return row === undefined ? undefined : String(row.value);
  }

  #setMeta(key: string, value: string): void {
    this.#sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  /** Read through `storage` each time: tests replace the SQL layer, not the room. */
  get #sql(): SqlStorage {
    return this.storage.sql;
  }
}
