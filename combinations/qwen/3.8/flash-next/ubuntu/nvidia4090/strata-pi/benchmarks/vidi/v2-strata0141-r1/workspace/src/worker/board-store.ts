/**
 * Board storage (anchor `persist.board_store`).
 *
 * One SQLite database per board, inside that board's Durable Object:
 *
 * ```text
 * storage_meta        key/value: storage_schema_version, snapshot_through_seq
 * updates             the append-only log: every Yjs update as it happened
 * snapshot_chunks     the compacted board, cut into rows of SNAPSHOT_CHUNK_BYTES
 * quarantined_updates log rows that could not be read, kept out of the way
 * ```
 *
 * Loading is `snapshot + log`. `append` writes one row per update, in the same
 * turn in which the update was applied, so nothing depends on anyone pressing
 * save (`persist.automatic`) and everything a board has ever been is still there
 * when the object wakes (`persist.restart`, `persist.reopen`).
 *
 * Failure rules, from the design:
 * - a damaged **log row** is moved to `quarantined_updates` and the rest of the
 *   board loads anyway (`persist.partial_damage`);
 * - an unreadable **snapshot** means most of the board is unreadable, so `load`
 *   reports `ok: false` and the room refuses to serve an empty board
 *   (`persist.load_failure`); nothing is deleted or quarantined on that path;
 * - `compactIfNeeded` runs in one `transactionSync`, so a failure rolls back and
 *   the previous snapshot and log are intact; it never throws.
 *
 * The storage dependency is declared structurally (the few methods this module
 * calls) rather than as `DurableObjectStorage`, so the chunking and threshold
 * logic can be unit tested outside the Workers runtime.
 */

import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/* ---------------------------------------------------------------------------
 * Pure pieces (unit tested in isolation: TC-01, TC-02)
 * ------------------------------------------------------------------------- */

/**
 * Split `data` into at most `size`-byte rows. An empty input produces no rows:
 * Yjs rejects a zero-length update, so an empty snapshot must not be written.
 */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) {
    throw new Error(`chunk size must be positive, got ${size}`);
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    // `slice` copies: a chunk must own its bytes, because a row's blob may
    // outlive the buffer it came from.
    chunks.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
  }
  return chunks;
}

/** Concatenate chunks back into the byte string they were cut from. */
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

/** Is a log of `count` rows holding `bytes` worth compacting? */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/* ---------------------------------------------------------------------------
 * Storage contract
 * ------------------------------------------------------------------------- */

/** Transaction origin for everything applied from storage: never re-stored, never broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

export type LoadResult =
  | {
      ok: true;
      /** Log rows applied. */
      applied: number;
      /** Log rows that could not be read, now in `quarantined_updates`. */
      quarantined: number;
      /** Bytes read from the snapshot and from the log, for load logging. */
      snapshotBytes: number;
      logBytes: number;
    }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** What is in the tables right now (integration tests and test hooks read it). */
export interface StoreStats {
  readonly schemaVersion: number | null;
  readonly snapshotThroughSeq: number;
  readonly updateRows: number;
  readonly updateBytes: number;
  readonly snapshotChunks: number;
  readonly snapshotBytes: number;
  readonly quarantinedRows: number;
}

export type SqlValue = ArrayBuffer | string | number | null;
type SqlRow = Record<string, SqlValue>;

/** A cursor over rows (`DurableObjectStorage.sql.exec` satisfies this). */
export interface SqlCursor {
  toArray(): SqlRow[];
}

/** The statements this module runs (`DurableObjectStorage.sql` satisfies this). */
export interface SqlStorageLike {
  exec(query: string, ...bindings: SqlValue[]): SqlCursor;
}

/** The part of Durable Object storage this module uses. */
export interface BoardStorage {
  readonly sql: SqlStorageLike;
  transactionSync<T>(closure: () => T): T;
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_SNAPSHOT_THROUGH = 'snapshot_through_seq';
/**
 * Story 5 (`share.not_found`): the row that says this board was deliberately
 * created. A board whose storage has it is a board that exists; a board whose
 * storage has rows but not it is a board that predates this feature
 * (`share.legacy_boards`) and still counts as existing.
 */
const META_CREATED_AT = 'created_at';
/** Where `corruptSnapshot` keeps the bytes it replaced (test hook only). */
const META_CORRUPT_BACKUP = 'test_snapshot_chunk_backup';

const SCHEMA_STATEMENTS: readonly string[] = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** SQLite hands blobs back as `ArrayBuffer`; Yjs wants a `Uint8Array`. */
const asBytes = (value: SqlValue | undefined): Uint8Array =>
  value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(0);

/** SQLite binds blobs from an `ArrayBuffer`, not from a view of one. */
const asBlob = (data: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
};

const asNumber = (value: SqlValue | undefined): number =>
  typeof value === 'number' ? value : Number(value ?? 0);

/**
 * Bytes as text, for the one case where a blob has to live in a TEXT column:
 * the backup `corruptSnapshot` keeps of the chunk it damaged.
 */
const toBase64 = (bytes: Uint8Array): string => {
  const STEP = 8_192;
  let out = '';
  for (let offset = 0; offset < bytes.byteLength; offset += STEP) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + STEP));
  }
  return btoa(out);
};

/** Text back to bytes. Exported for the room's own test seeding (story 5, TC-31). */
export const fromBase64 = (text: string): Uint8Array => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
};

/**
 * Deterministic bytes that are not a Yjs update, the same length as what they
 * replace. `corruptSnapshot` uses them when a caller does not bring its own.
 */
const randomBytesOf = (length: number, seed = 99): Uint8Array => {
  const bytes = new Uint8Array(Math.max(1, length));
  let state = seed;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[index] = state % 256;
  }
  return bytes;
};

/**
 * One board's stored state.
 *
 * The instance is per Durable Object instance: it holds the row count and byte
 * total of the log in memory, so the compaction decision never needs a
 * `COUNT(*)` on the hot write path.
 */
export class BoardStore {
  private readonly storage: BoardStorage;
  private readonly sql: SqlStorageLike;
  /** Log rows and bytes above `snapshot_through_seq`, tracked in memory. */
  private logRows = 0;
  private logBytes = 0;
  /** `snapshot_through_seq` as last read or written. */
  private throughSeq = 0;

  constructor(storage: BoardStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  /**
   * Are this board's tables there at all?
   *
   * Story 5 makes this the difference between "a board nobody has ever made"
   * and "a board that is simply empty": probing an unknown link must leave no
   * storage behind (`share.not_found`), so nothing creates tables except an
   * explicit creation (`initialize()` on the room) or a first write.
   */
  hasTables(): boolean {
    const names = this.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => row.name);
    return (
      names.includes('storage_meta') && names.includes('updates') && names.includes('snapshot_chunks')
    );
  }

  /**
   * Does this board exist? Read-only (`share.open_link`, `share.not_found`).
   *
   * True when the board was created (`created_at`), or when it has anything
   * stored at all - which is how a board that predates this feature still opens
   * at the address people already have (`share.legacy_boards`). Nothing here
   * creates a table or a row, so probing a made-up link leaves the board exactly
   * as non-existent as it was (TC-06, TC-09).
   */
  existsReadOnly(): boolean {
    if (!this.hasTables()) {
      return false;
    }
    if (this.createdAt() !== null) {
      return true;
    }
    if (this.sql.exec('SELECT 1 FROM updates LIMIT 1').toArray().length > 0) {
      return true;
    }
    return this.sql.exec('SELECT 1 FROM snapshot_chunks LIMIT 1').toArray().length > 0;
  }

  /** `created_at` as stored, or null when this board was never created. */
  createdAt(): number | null {
    if (!this.hasTables()) {
      return null;
    }
    const row = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_CREATED_AT)
      .toArray()[0];
    if (row === undefined) {
      return null;
    }
    const value = Number(row.value ?? NaN);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * Record that this board has been created, once.
   *
   * Returns `true` when this call is the one that made the board (the tables are
   * created too) and `false` when the board was already created, which is what
   * keeps an existing board from ever being re-initialised (TC-15).
   */
  markCreated(): boolean {
    if (this.createdAt() !== null) {
      return false;
    }
    const at = Date.now();
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        META_CREATED_AT,
        String(at),
      );
    });
    return true;
  }

  /**
   * Write log rows without claiming the board was created: the shape a board
   * that predates this feature has - content, no `created_at`
   * (`share.legacy_boards`). Test hooks only.
   */
  seedLegacyRows(updates: readonly Uint8Array[]): number {
    // Bytes, never their text. Durable Object RPC hands over what it is given,
    // and storing text as if it were a Yjs update writes a row of the right
    // length and none of its content, so it is refused here instead.
    for (const update of updates) {
      if (!(update instanceof Uint8Array)) {
        throw new TypeError('seedLegacyRows takes Uint8Array updates');
      }
    }
    // Seeding is a write, so the tables it writes into are made first - this is
    // a test setting up a board that predates story 5, not a probe of a link.
    this.migrate();
    this.storage.transactionSync(() => {
      for (const update of updates) {
        this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', asBlob(update), update.byteLength);
      }
    });
    this.logRows += updates.length;
    return updates.length;
  }

  /**
   * Create the tables if they are not there yet and record the storage schema
   * version.
   *
   * Only `initialize()` (through `markCreated`) and a board's first write call
   * it. Opening a board nobody has ever created now creates nothing at all
   * (`share.not_found`); a board that was created and never edited has tables
   * and no rows (TC-25).
   */
  migrate(): void {
    this.storage.transactionSync(() => {
      for (const statement of SCHEMA_STATEMENTS) {
        this.sql.exec(statement);
      }
      const existing = this.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', META_SCHEMA_VERSION)
        .toArray()[0];
      if (existing === undefined) {
        this.sql
          .exec('INSERT INTO storage_meta (key, value) VALUES (?, ?)', META_SCHEMA_VERSION, String(STORAGE_SCHEMA_VERSION));
      }
    });
  }

  /**
   * Append one Yjs update. SQL errors are rethrown: the caller discards this
   * room rather than keep serving a board it cannot save (`persist.save_failure`).
   */
  append(update: Uint8Array): void {
    // A board can only be written to after it was created, but a store used
    // directly (tests, a room that woke before story 5 shipped) must still work:
    // migrating here keeps story 4's write path intact while `load` stays a
    // pure read.
    if (!this.hasTables()) {
      this.migrate();
    }
    this.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO updates (data, bytes) VALUES (?, ?)', asBlob(update), update.byteLength);
    });
    this.logRows += 1;
    this.logBytes += update.byteLength;
  }

  /**
   * Read the board into `doc`: the snapshot first, then every log row above it.
   *
   * `ok: false` is a refusal to serve, not an empty board: the caller must not
   * present the result as a board that has nothing on it.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // A board whose tables were never made is an empty board, not a broken
      // one - and reading it must not make those tables (`share.not_found`).
      if (!this.hasTables()) {
        this.logRows = 0;
        this.logBytes = 0;
        this.throughSeq = 0;
        return { ok: true, applied: 0, quarantined: 0, snapshotBytes: 0, logBytes: 0 };
      }

      const meta = this.readMeta();

      const chunkRows = this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY idx ASC').toArray();
      let snapshotBytes = 0;
      if (chunkRows.length > 0) {
        const snapshot = joinChunks(chunkRows.map((row) => asBytes(row.data)));
        try {
          // Read the snapshot before applying any of it: a damaged snapshot must
          // leave the document untouched, so a refused load can never half-load.
          Y.decodeUpdate(snapshot);
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
          snapshotBytes = snapshot.byteLength;
        } catch (error) {
          // Snapshot damage is fatal and nothing here has been written: the
          // snapshot and the log stay exactly as they are (TC-10).
          return { ok: false, reason: 'snapshot-unreadable', error: describe(error) };
        }
      }

      const rows = this.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq ASC', meta.throughSeq)
        .toArray();

      let applied = 0;
      let bytes = 0;
      let quarantined = 0;
      for (const row of rows) {
        const seq = asNumber(row.seq);
        const update = asBytes(row.data);
        try {
          // Read the row before applying it. Yjs integrates as it reads, so a
          // row that only fails halfway would leave half of its bytes in the
          // document; decoding first means a damaged row is set aside whole.
          Y.decodeUpdate(update);
          Y.applyUpdate(doc, update, LOAD_ORIGIN);
          applied += 1;
          bytes += update.byteLength;
        } catch (error) {
          this.quarantine(seq, update, describe(error));
          quarantined += 1;
        }
      }

      this.logRows = applied;
      this.logBytes = bytes;
      this.throughSeq = meta.throughSeq;
      return { ok: true, applied, quarantined, snapshotBytes, logBytes: bytes };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: describe(error) };
    }
  }

  /**
   * Fold the log into the snapshot when it has grown past either threshold, so
   * the work of loading a long-lived board stays bounded.
   *
   * One transaction: if any statement fails, everything is rolled back and the
   * board is still loadable from the previous snapshot and log. Never throws.
   *
   * `force` folds regardless of the thresholds. Only the test hooks pass it: a
   * test that wants a board to be in the Snapshotted state cannot wait for a
   * person to type five hundred notes.
   */
  compactIfNeeded(doc: Y.Doc, options: { force?: boolean } = {}): boolean {
    if (!options.force && !shouldCompact(this.logRows, this.logBytes)) {
      return false;
    }
    try {
      const state = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(state);
      const throughSeq = this.storage.transactionSync(() => {
        const row = this.sql.exec('SELECT MAX(seq) AS max_seq FROM updates').toArray()[0];
        const maxSeq = row === undefined ? 0 : asNumber(row.max_seq);
        this.sql.exec('DELETE FROM snapshot_chunks');
        chunks.forEach((chunk, index) => {
          this.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', index, asBlob(chunk));
        });
        // The in-memory document already holds snapshot plus log, so the whole
        // log is represented by the new snapshot.
        this.sql.exec('DELETE FROM updates');
        this.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          META_SNAPSHOT_THROUGH,
          String(maxSeq),
        );
        return maxSeq;
      });
      this.logRows = 0;
      this.logBytes = 0;
      this.throughSeq = throughSeq;
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'board-compaction-failed', error: describe(error), updates: this.logRows }),
      );
      return false;
    }
  }

  /** Row counts and byte totals, for tests and test hooks only. */
  stats(): StoreStats {
    if (!this.hasTables()) {
      return {
        schemaVersion: null,
        snapshotThroughSeq: 0,
        updateRows: 0,
        updateBytes: 0,
        snapshotChunks: 0,
        snapshotBytes: 0,
        quarantinedRows: 0,
      };
    }
    const meta = this.readMeta();
    const counts = (query: string): SqlRow => this.sql.exec(query).toArray()[0] ?? {};
    const updates = counts('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM updates');
    const chunks = counts('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM snapshot_chunks');
    const quarantined = counts('SELECT COUNT(*) AS n FROM quarantined_updates');
    return {
      schemaVersion: meta.schemaVersion,
      snapshotThroughSeq: meta.throughSeq,
      updateRows: asNumber(updates.n),
      updateBytes: asNumber(updates.b),
      snapshotChunks: asNumber(chunks.n),
      snapshotBytes: asNumber(chunks.b),
      quarantinedRows: asNumber(quarantined.n),
    };
  }

  /** `snapshot_through_seq`, the seq up to which the log is folded in. */
  snapshotThroughSeq(): number {
    return this.throughSeq;
  }

  /** The log rows and bytes this instance knows about (in memory, no query). */
  logSize(): { rows: number; bytes: number } {
    return { rows: this.logRows, bytes: this.logBytes };
  }

  /**
   * Replace snapshot chunk 0 with `damage`, keeping the bytes it replaced in
   * `storage_meta` so `repairSnapshot` can put them back.
   *
   * Only the test hooks call this (`persist.client_status`, TC-15, TC-16, TC-24):
   * it is how a test produces a board whose snapshot cannot be read, and then a
   * board whose snapshot can be, without touching a real disk.
   */
  corruptSnapshot(damage?: Uint8Array): { ok: boolean; reason?: string; bytes?: number } {
    if (!this.hasTables()) {
      return { ok: false, reason: 'no-snapshot' };
    }
    const row = this.sql.exec('SELECT data FROM snapshot_chunks WHERE idx = ?', 0).toArray()[0];
    const original = row === undefined ? undefined : asBytes(row.data);
    if (original === undefined || original === null) {
      return { ok: false, reason: 'no-snapshot' };
    }
    const bytes = damage ?? randomBytesOf(original.byteLength);
    const saved = toBase64(original);
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
        META_CORRUPT_BACKUP,
        saved,
      );
      this.sql.exec('INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, asBlob(bytes));
    });
    return { ok: true, bytes: original.byteLength };
  }

  /** Put the saved chunk 0 back, and forget the backup. */
  repairSnapshot(): { ok: boolean; reason?: string } {
    if (!this.hasTables()) {
      return { ok: false, reason: 'no-backup' };
    }
    const row = this.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?', META_CORRUPT_BACKUP)
      .toArray()[0];
    const saved = row === undefined ? undefined : row.value;
    if (typeof saved !== 'string') {
      return { ok: false, reason: 'no-backup' };
    }
    const bytes = fromBase64(saved);
    this.storage.transactionSync(() => {
      this.sql.exec('INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, asBlob(bytes));
      this.sql.exec('DELETE FROM storage_meta WHERE key = ?', META_CORRUPT_BACKUP);
    });
    return { ok: true };
  }

  private readMeta(): { throughSeq: number; schemaVersion: number | null } {
    const rows = this.sql
      .exec('SELECT key, value FROM storage_meta WHERE key IN (?, ?)', META_SCHEMA_VERSION, META_SNAPSHOT_THROUGH)
      .toArray();
    let throughSeq = 0;
    let schemaVersion: number | null = null;
    for (const row of rows) {
      if (row.key === META_SNAPSHOT_THROUGH) {
        throughSeq = Number(row.value ?? 0);
      }
      if (row.key === META_SCHEMA_VERSION) {
        schemaVersion = Number(row.value ?? NaN);
      }
    }
    this.throughSeq = throughSeq;
    return { throughSeq, schemaVersion };
  }

  /** Move one unreadable log row out of the log, keeping the bytes and why. */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.sql.exec(
        'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        asBlob(data),
        error,
        Date.now(),
      );
    });
    console.error(JSON.stringify({ event: 'board-update-quarantined', seq, error }));
  }
}
