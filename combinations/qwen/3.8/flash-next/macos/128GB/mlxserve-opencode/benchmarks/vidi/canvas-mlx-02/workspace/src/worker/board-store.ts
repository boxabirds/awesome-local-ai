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

  /** Create the tables and record the storage layout version. Writes no update rows. */
  migrate(): void {
    for (const statement of SCHEMA_STATEMENTS) this.exec(statement);
    this.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)`,
      META_SCHEMA_VERSION,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /** The storage layout version, or null when migrate() has never run. */
  schemaVersion(): string | null {
    const rows = this.exec<{ value: unknown }>(
      `SELECT value FROM storage_meta WHERE key = ?`,
      META_SCHEMA_VERSION,
    );
    return rows.length === 0 ? null : String(rows[0].value);
  }

  /** Append one Yjs update. Throws on a storage failure - the room resets on that. */
  append(update: Uint8Array): void {
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
    const rows = this.exec<{ m: unknown }>(`SELECT COALESCE(MAX(seq), 0) AS m FROM updates`);
    return asNumber(rows[0]?.m, 0);
  }

  countRows(table: 'updates' | 'snapshot_chunks' | 'quarantined_updates'): number {
    const rows = this.exec<{ n: unknown }>(`SELECT COUNT(*) AS n FROM ${table}`);
    return asNumber(rows[0]?.n, 0);
  }

  /** Total bytes of the update log rows (independent of the in-memory counters). */
  logBytes(): number {
    const rows = this.exec<{ n: unknown }>(`SELECT COALESCE(SUM(bytes), 0) AS n FROM updates`);
    return asNumber(rows[0]?.n, 0);
  }

  chunkCount(): number {
    return this.countRows('snapshot_chunks');
  }

  /** Byte length of every snapshot chunk, in chunk order. */
  chunkSizes(): number[] {
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
