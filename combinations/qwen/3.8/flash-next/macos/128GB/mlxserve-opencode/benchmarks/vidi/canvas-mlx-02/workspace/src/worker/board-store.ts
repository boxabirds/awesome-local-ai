// BoardRoom's durable state: a Yjs update log + chunked snapshot in the Durable
// Object's own SQLite storage (`ctx.storage.sql`), plus the compaction that
// folds the log into a snapshot.
//
// The invariant this module exists to protect: every byte the room broadcasts
// is already in SQLite by the time the broadcast happens (the room calls
// `append()` before it relays). Compaction is an optimisation - if it fails its
// transaction rolls back, the log keeps growing, and the next attempt retries.
//
// The storage handle is typed structurally (BoardStorage) rather than as the
// `DurableObjectStorage` global, so this module also typechecks under the
// browser/tsconfig project and the unit suite can drive it with a recording fake.
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config.ts';

/** Bumped only when the layout changes incompatibly (it is not a data version). */
export { STORAGE_SCHEMA_VERSION };

/**
 * Origin used for every update applied while loading a board. The room must
 * never write back what it just read: `doc.on('update')` handlers skip any
 * update whose origin is this symbol.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('board-store-load');

export type SqlBinding = null | number | string | ArrayBuffer;

/** The slice of `DurableObjectStorage` this store uses. */
export interface BoardStorage {
  readonly sql: {
    exec(sql: string, ...bindings: SqlBinding[]): Iterable<Record<string, unknown>>;
  };
  transactionSync<T>(fn: () => T): T;
}

export type LoadFailureReason = 'snapshot-unreadable' | 'sql-error';

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: LoadFailureReason; error: string };

/**
 * The schema, as one idempotent statement per entry (order matters only for
 * readability). `updates.seq` is AUTOINCREMENT so a seq is never reused, which
 * is what makes `snapshot_through_seq` and the quarantine key stable.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
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
     data BLOB NOT NULL,
     bytes INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS quarantined_updates (
     seq INTEGER PRIMARY KEY,
     data BLOB NOT NULL,
     error TEXT NOT NULL,
     quarantined_at INTEGER NOT NULL
   )`,
];

/** The meta keys this store owns. */
export const META_SCHEMA_VERSION = 'storage_schema_version';
export const META_SNAPSHOT_THROUGH_SEQ = 'snapshot_through_seq';
/**
 * The meta key that says this board was created. It is written by exactly one
 * thing - `BoardRoom.initialize()`, which only the create path calls - and it is
 * what makes a link either somebody's board or nobody's (story 5). A board that
 * was here before that key existed is still a board: see `existsReadOnly()`.
 */
export const META_CREATED_AT = 'created_at';

/** The tables this store owns, in creation order. */
export const OWN_TABLES = [
  'storage_meta',
  'updates',
  'snapshot_chunks',
  'quarantined_updates',
] as const;

export type OwnTable = (typeof OWN_TABLES)[number];

export function errorMessage(err: unknown): string {
  const e = err as { message?: unknown } | null | undefined;
  return typeof e?.message === 'string' ? e.message : String(err);
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const v = value as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  throw new Error(`expected a BLOB value, got ${typeof value}`);
}

function asBinding(value: Uint8Array): ArrayBuffer {
  // SQLite binds ArrayBuffer; copy so the bound bytes can never be mutated by
  // the caller afterwards (Yjs reuses temporary buffers).
  return value.slice().buffer;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Split `data` into chunks of at most `size` bytes. Pure: no storage, no Yjs.
 * An empty input yields no chunks (an empty board has an empty snapshot).
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    out.push(data.subarray(offset, Math.min(offset + size, data.length)));
  }
  return out;
}

/** Inverse of chunkBytes: concatenation, order preserved. Pure. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** True when the update log is big enough that a snapshot is worth writing. */
export function shouldCompact(updateCount: number, updateBytes: number): boolean {
  return updateCount >= COMPACTION_UPDATE_COUNT || updateBytes >= COMPACTION_BYTES;
}

export class BoardStore {
  private readonly storage: BoardStorage;
  private readonly chunkSize: number;
  /** Counters for the log *after* the snapshot; kept in memory, no COUNT(*) on the hot path. */
  private rows = 0;
  private bytes = 0;
  private throughSeq = 0;
  /**
   * Whether the tables are known to be here for THIS store instance. It is set
   * by `migrate()` and by a `load()` that found them, so a board that has never
   * been written can be read back as empty without ever being created - which is
   * the whole reason a mistyped link leaves no storage behind.
   */
  private tablesConfirmed = false;
  /**
   * Test-only: when positive, append() throws *after* its row has been written,
   * so a test can see whether the surrounding Durable Object transaction really
   * rolled the row back. Nothing in production code ever sets this.
   */
  private failAfterAppend = 0;

  constructor(storage: BoardStorage, chunkSize: number = SNAPSHOT_CHUNK_BYTES) {
    this.storage = storage;
    this.chunkSize = chunkSize;
  }

  /** Uncompacted update rows / bytes (drives shouldCompact). */
  get updateCount(): number {
    return this.rows;
  }
  get updateBytes(): number {
    return this.bytes;
  }
  /** Highest log seq folded into the current snapshot. */
  get snapshotThroughSeq(): number {
    return this.throughSeq;
  }

  // Overridable seams: the integration tests subclass the store to make one
  // named statement throw, so the injected failure still runs inside the real
  // SQLite transaction semantics.
  protected exec<T = Record<string, unknown>>(sql: string, ...bindings: SqlBinding[]): T[] {
    // Eagerly materialised: a cursor must not stay open across a write.
    return Array.from(this.storage.sql.exec(sql, ...bindings)) as unknown as T[];
  }

  protected transaction(fn: () => void): void {
    this.storage.transactionSync(fn);
  }

  /**
   * Which of this store's tables actually exist, read out of the catalogue. The
   * one query that is allowed to be asked before a board is known to exist, and
   * the only reason `existsReadOnly()` can answer without laying down tables.
   */
  existingTables(): Set<string> {
    const placeholders = OWN_TABLES.map(() => '?').join(', ');
    const rows = this.exec<{ name: unknown }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      ...OWN_TABLES,
    );
    return new Set(rows.map((row) => String(row.name)));
  }

  /**
   * Does this board exist? Read-only, and it never creates anything: a board
   * exists if it was created (`storage_meta.created_at`) OR - for a board that
   * was already here before that key existed - if it has any content at all, one
   * row in `updates` or `snapshot_chunks`. A code that was only ever probed has
   * no tables, no key and no rows, and so stays nonexistent however often it is
   * asked, which is what a mistyped or made-up link must meet (TC-06, TC-09).
   */
  existsReadOnly(): boolean {
    const tables = this.existingTables();
    if (tables.has('storage_meta')) {
      const rows = this.exec<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM storage_meta WHERE key = ?`,
        META_CREATED_AT,
      );
      if (asNumber(rows[0]?.n, 0) > 0) return true;
    }
    if (tables.has('updates') && this.countRows('updates') > 0) return true;
    if (tables.has('snapshot_chunks') && this.countRows('snapshot_chunks') > 0) return true;
    return false;
  }

  /** When this board was created, or null when nothing created it. */
  createdAt(): number | null {
    if (!this.existingTables().has('storage_meta')) return null;
    const rows = this.exec<{ value: unknown }>(
      `SELECT value FROM storage_meta WHERE key = ?`,
      META_CREATED_AT,
    );
    return rows.length === 0 ? null : asNumber(rows[0].value, 0);
  }

  /**
   * Write the creation stamp unless the board already has one. Returns true only
   * for the call that actually created the board, so the room can tell 'created'
   * from 'exists' - and so two requests that raced each other cannot both be
   * told they made a board. Call inside a transaction.
   */
  setCreatedAtIfAbsent(createdAtMs: number): boolean {
    const existing = this.exec<{ value: unknown }>(
      `SELECT value FROM storage_meta WHERE key = ?`,
      META_CREATED_AT,
    );
    if (existing.length > 0) return false;
    this.exec(`INSERT INTO storage_meta (key, value) VALUES (?, ?)`, META_CREATED_AT, String(createdAtMs));
    return true;
  }

  /**
   * Create the tables and record the storage layout version. Writes no update
   * rows, and is only ever reached by a board being written for the first time
   * (`initialize()`, or the first `append()` of a board that pre-dates the key).
   */
  migrate(): void {
    for (const statement of SCHEMA_STATEMENTS) this.exec(statement);
    this.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)`,
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
    this.tablesConfirmed = true;
  }

  /**
   * The storage layout version, or null when migrate() has never run. A board that
   * was only ever looked at has no layout to report, and asking for one is not a
   * reason to create a table.
   */
  schemaVersion(): string | null {
    if (!this.existingTables().has('storage_meta')) return null;
    const rows = this.exec<{ value: unknown }>(
      `SELECT value FROM storage_meta WHERE key = ?`,
      META_SCHEMA_VERSION,
    );
    return rows.length === 0 ? null : String(rows[0].value);
  }

  /** Append one Yjs update. Throws on a storage failure - the room resets on that. */
  append(update: Uint8Array): void {
    // Laid down here rather than at construct, so a board that is only ever read
    // - a link that was mistyped and merely checked - stays without a table.
    if (!this.tablesConfirmed) this.migrate();
    this.exec(`INSERT INTO updates (bytes, data) VALUES (?, ?)`, update.length, asBinding(update));
    // Only after the write succeeded: a failed append must not inflate the log.
    this.rows += 1;
    this.bytes += update.length;
    if (this.failAfterAppend > 0) {
      // The INSERT above already ran, inside the caller's transaction: throwing
      // here is what proves the rollback.
      this.failAfterAppend -= 1;
      throw new Error('injected storage failure after append');
    }
  }

  /** Test-only. Arm `failAfterAppend`. */
  testFailAfterNextAppend(times = 1): void {
    this.failAfterAppend = times;
  }

  /**
   * Read the snapshot then the update log into `doc`, in order, with origin
   * LOAD_ORIGIN. An update row that throws on apply is quarantined (moved with
   * its seq and the error text) and deleted from the log, in one transaction;
   * the rest of the log still loads. A failed snapshot read is unrecoverable and
   * reported - the board is NOT served.
   */
  load(doc: Y.Doc): LoadResult {
    // A board that has never been written has no tables at all. That is an EMPTY
    // board, not a schema to create: `migrate()` belongs to `initialize()` and to
    // the first `append()`, never to a read, so checking whether a link exists
    // cannot leave a board behind.
    const tables = this.existingTables();
    this.tablesConfirmed = OWN_TABLES.every((table) => tables.has(table));
    if (tables.size === 0) return { ok: true, quarantined: 0 };
    if (!this.tablesConfirmed) {
      // Some but not all of the layout is there. Half a schema is a broken
      // board, and reading it would be a guess, so it is reported as the failed
      // read it is and nothing is written to "fix" it.
      const missing = OWN_TABLES.filter((table) => !tables.has(table)).join(', ');
      return { ok: false, reason: 'sql-error', error: `board storage is incomplete (missing ${missing})` };
    }

    let snapshot: Uint8Array;
    try {
      const chunks: Uint8Array[] = [];
      for (const row of this.exec<{ data: unknown }>(`SELECT data FROM snapshot_chunks ORDER BY idx`)) {
        chunks.push(asBytes(row.data));
      }
      snapshot = joinChunks(chunks);
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: errorMessage(err) };
    }

    if (snapshot.length > 0) {
      try {
        Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
      } catch (err) {
        return { ok: false, reason: 'snapshot-unreadable', error: errorMessage(err) };
      }
    }

    let quarantined = 0;
    try {
      this.throughSeq = this.metaNumber(META_SNAPSHOT_THROUGH_SEQ, 0);
      const pending = this.exec<{ seq: unknown; data: unknown }>(
        `SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq`,
        this.throughSeq,
      );
      let applied = 0;
      let appliedBytes = 0;
      for (const row of pending) {
        const seq = asNumber(row.seq, 0);
        const data = asBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          applied += 1;
          appliedBytes += data.length;
        } catch (err) {
          const error = errorMessage(err);
          const bytes = data.slice();
          this.transaction(() => {
            this.exec(
              `INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
              seq,
              asBinding(bytes),
              error,
              Date.now(),
            );
            this.exec(`DELETE FROM updates WHERE seq = ?`, seq);
          });
          console.error(`[board] quarantined update row ${seq}: ${error}`);
          quarantined += 1;
        }
      }
      this.rows = applied;
      this.bytes = appliedBytes;
      return { ok: true, quarantined };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: errorMessage(err) };
    }
  }

  /** True when the log crossed a threshold and compaction is worthwhile. */
  shouldCompact(): boolean {
    return shouldCompact(this.rows, this.bytes);
  }

  /** Compact when the thresholds say so. Returns true if a snapshot was written. */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!this.shouldCompact()) return false;
    return this.compact(doc);
  }

  /**
   * Write `doc`'s state as the snapshot and trim the compacted log rows, in one
   * synchronous transaction (so it either fully lands or fully rolls back).
   * Returns false - after logging - when the transaction failed; the previous
   * snapshot and log are then untouched and the board keeps serving.
   */
  compact(doc: Y.Doc): boolean {
    const snapshot = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(snapshot, this.chunkSize);
    const through = this.maxLogSeq();
    try {
      this.transaction(() => {
        this.exec(`DELETE FROM snapshot_chunks`);
        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          this.exec(
            `INSERT INTO snapshot_chunks (idx, data, bytes) VALUES (?, ?, ?)`,
            idx,
            asBinding(chunk),
            chunk.length,
          );
        }
        this.exec(`DELETE FROM updates WHERE seq <= ?`, through);
        this.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)`,
          META_SNAPSHOT_THROUGH_SEQ,
          String(through),
        );
      });
    } catch (err) {
      // Rolled back by transactionSync. The log is still complete, so the next
      // attempt retries; the board keeps serving from memory meanwhile.
      console.error(`[board] compaction rolled back, keeping the log: ${errorMessage(err)}`);
      return false;
    }
    this.rows = 0;
    this.bytes = 0;
    this.throughSeq = through;
    return true;
  }

  // ---- Small accessors used by the room and the test-only hooks ------------

  /** Highest seq currently in the update log (0 when the log is empty). */
  maxLogSeq(): number {
    if (!this.hasTable('updates')) return 0;
    const rows = this.exec<{ m: unknown }>(`SELECT COALESCE(MAX(seq), 0) AS m FROM updates`);
    return asNumber(rows[0]?.m, 0);
  }

  /**
   * Rows in one of the store's tables. A table that was never created holds
   * nothing, and saying so here is what lets every read below be asked about a
   * board that does not exist without asking SQLite for a table that isn't there.
   */
  countRows(table: 'updates' | 'snapshot_chunks' | 'quarantined_updates'): number {
    if (!this.existingTables().has(table)) return 0;
    const rows = this.exec<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${table}`);
    return asNumber(rows[0]?.n, 0);
  }

  /** Does this store's own tables exist yet? The catalogue, not an assumption. */
  hasTable(table: OwnTable): boolean {
    return this.existingTables().has(table);
  }

  /**
   * Run one statement and hand back its rows, for a test that has to read the
   * storage this store reads. Two doors reach it and neither is in the product:
   * the room's TEST_HOOKS-gated `/__test/boards/:id/sql` route, and
   * `runInDurableObject` inside the integration suite. Production code paths use
   * the named methods above. Read counts and keys through it rather than BLOBs,
   * and pass bindings separately rather than interpolating them, so an assertion
   * about a meta key is an assertion about that key.
   */
  testQuery(sql: string, bindings: SqlBinding[] = []): Record<string, unknown>[] {
    return this.exec(sql, ...bindings);
  }

  /** Total bytes of the update log rows (independent of the in-memory counters). */
  logBytes(): number {
    if (!this.hasTable('updates')) return 0;
    const rows = this.exec<{ n: unknown }>(`SELECT COALESCE(SUM(bytes), 0) AS n FROM updates`);
    return asNumber(rows[0]?.n, 0);
  }

  chunkCount(): number {
    return this.countRows('snapshot_chunks');
  }

  /** Byte length of every snapshot chunk, in chunk order. */
  chunkSizes(): number[] {
    if (!this.hasTable('snapshot_chunks')) return [];
    return this
      .exec<{ n: unknown }>(`SELECT bytes AS n FROM snapshot_chunks ORDER BY idx`)
      .map((row) => asNumber(row.n, 0));
  }

  readChunk(idx: number): Uint8Array | null {
    const rows = this.exec<{ data: unknown }>(`SELECT data FROM snapshot_chunks WHERE idx = ?`, idx);
    return rows.length === 0 ? null : asBytes(rows[0].data);
  }

  /** Overwrite (or create) one snapshot chunk. Used by the test-only hooks. */
  writeChunk(idx: number, data: Uint8Array): void {
    this.exec(
      `INSERT OR REPLACE INTO snapshot_chunks (idx, data, bytes) VALUES (?, ?, ?)`,
      idx,
      asBinding(data),
      data.length,
    );
  }

  getMeta(key: string): string | null {
    const rows = this.exec<{ value: unknown }>(`SELECT value FROM storage_meta WHERE key = ?`, key);
    return rows.length === 0 ? null : String(rows[0].value);
  }

  setMeta(key: string, value: string): void {
    this.exec(`INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)`, key, value);
  }

  private metaNumber(key: string, fallback: number): number {
    return asNumber(this.getMeta(key), fallback);
  }
}
