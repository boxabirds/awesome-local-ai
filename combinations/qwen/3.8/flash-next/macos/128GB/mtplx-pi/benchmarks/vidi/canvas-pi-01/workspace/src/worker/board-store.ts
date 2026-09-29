/**
 * Story 4 · BoardStore (design "Board storage" contract).
 *
 * Owns the SQLite-backed Durable Object storage for one board. It:
 *  - creates the schema (migrate),
 *  - appends update bytes to the log (append),
 *  - replays the snapshot + log into a Y.Doc (load), quarantining damaged rows,
 *  - compacts the log into chunked snapshots when thresholds are exceeded.
 *
 * All SQL is synchronous (Durable Object SQLite). The class is constructed with
 * `ctx.storage` and uses `storage.sql` / `storage.transactionSync`. The
 * `StorageLike` interface is a structural subset so the module also compiles
 * under the browser tsconfig and can be unit-tested outside workerd; the real
 * `DurableObjectStorage` satisfies it. Integration tests inject failures by
 * wrapping it (design "Mock vs real boundaries").
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  LOAD_RETRY_MIN_INTERVAL_MS,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Test seams (never set in production code). Design "Mock vs real boundaries"
 * injects storage failures by wrapping `BoardStore`, *outside* SQLite, so the
 * real transaction semantics still apply. `loadAttempt` lets a test assert that
 * the load-retry interval really gates reloads.
 */
export const testHooks: {
  /** Reject the next N SQL statements (writes *and* reads). */
  failNextSql: number;
  /** Number of `load()` calls so far (for retry-interval assertions). */
  loadAttempts: number;
  /** Override the load-retry interval so time-coupled tests stay fast. */
  loadRetryMs: number | null;
} = {
  failNextSql: 0,
  loadAttempts: 0,
  loadRetryMs: null,
};

/** Reset every seam (call from `afterEach`). */
export function resetTestHooks(): void {
  testHooks.failNextSql = 0;
  testHooks.loadAttempts = 0;
  testHooks.loadRetryMs = null;
}

/** The load-retry interval currently in force (test override or the config). */
export function loadRetryIntervalMs(): number {
  return testHooks.loadRetryMs ?? LOAD_RETRY_MIN_INTERVAL_MS;
}

function exec(storage: StorageLike, query: string, ...bindings: unknown[]): SqlCursorLike {
  if (testHooks.failNextSql > 0) {
    testHooks.failNextSql -= 1;
    throw new Error('injected SQL failure');
  }
  return storage.sql.exec(query, ...bindings);
}

/**
 * A SQL read that is *not* counted by the `failNextSql` seam. The existence
 * probe is a pure read that must never create tables (PRD share.legacy_boards
 * / share.not_found): an injected failure is aimed at the write path, so the
 * probe bypasses the seam and talks to SQLite directly.
 */
function peek(storage: StorageLike, query: string, ...bindings: unknown[]): SqlCursorLike {
  return storage.sql.exec(query, ...bindings);
}

export interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
  one(): Record<string, unknown> | undefined;
}

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

/** The structural subset of `DurableObjectStorage` this module needs. */
export interface StorageLike {
  sql: SqlLike;
  transactionSync<T>(closure: () => T): T;
}

/** Sentinel origin for updates applied during load, so they are not re-stored. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

// ---- Pure helpers (testable without I/O) ----

/**
 * Split `data` into at most `size`-byte chunks. Empty input → empty array.
 * (TC-01 boundaries: 0, 1, size, size+1 bytes.)
 */
export function chunkBytes(data: Uint8Array, size = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.byteLength === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.slice(offset, offset + size));
  }
  return chunks;
}

/** Concatenate chunks back into a single Uint8Array. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Should compaction be triggered? True when count ≥ COMPACTION_UPDATE_COUNT
 * or bytes ≥ COMPACTION_BYTES (TC-02 boundaries: just below / exactly).
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

// ---- LoadResult ----

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

function asBlob(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// ---- BoardStore class ----

export class BoardStore {
  private readonly storage: StorageLike;
  /** Tracked after load/append to avoid COUNT(*) per write. */
  private rowCount = 0;
  private byteTotal = 0;

  constructor(storage: StorageLike) {
    this.storage = storage;
  }

  private sql(query: string, ...bindings: unknown[]): SqlCursorLike {
    return exec(this.storage, query, ...bindings);
  }

  /** A read that bypasses the `failNextSql` seam (see `peek`). */
  private readSql(query: string, ...bindings: unknown[]): SqlCursorLike {
    return peek(this.storage, query, ...bindings);
  }

  /** Is one of our tables present? A read of `sqlite_master`, never a write. */
  private tableExists(name: string): boolean {
    const row = this.readSql(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      name,
    ).toArray()[0];
    return row !== undefined;
  }

  /** Do the board's tables exist? A read of `sqlite_master`, never a write. */
  hasTables(): boolean {
    return this.tableExists('updates');
  }

  /**
   * Read-only existence test (design "Existence rule"). A board exists when it
   * has a `created_at` marker, **or** (legacy boards, PRD share.legacy_boards)
   * any row in `updates` or `snapshot_chunks`. It queries `sqlite_master`
   * first and creates nothing: for an id that was never created there are no
   * tables at all and this returns false without writing (PRD share.not_found,
   * TC-06 / TC-09). Each table is checked for before it is queried, so a
   * partially-built board cannot throw its way into a wrong answer, and a SQL
   * error is read as "does not exist" so a probe can never be served a
   * misleadingly empty board.
   */
  existsReadOnly(): boolean {
    try {
      if (
        this.tableExists('storage_meta') &&
        this.readSql(`SELECT value FROM storage_meta WHERE key = 'created_at'`)
          .toArray()[0] !== undefined
      ) {
        return true;
      }
      if (
        this.tableExists('updates') &&
        this.readSql(`SELECT 1 FROM updates LIMIT 1`).toArray()[0] !== undefined
      ) {
        return true;
      }
      if (
        this.tableExists('snapshot_chunks') &&
        this.readSql(`SELECT 1 FROM snapshot_chunks LIMIT 1`).toArray()[0] !== undefined
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** The board's creation time, in epoch ms, or `undefined` if not created. */
  createdAt(): number | undefined {
    const row = this.readSql(
      `SELECT value FROM storage_meta WHERE key = 'created_at'`,
    ).toArray()[0];
    return row === undefined ? undefined : Number(row['value']);
  }

  /**
   * Record the creation marker (called only from `initialize`, inside a write
   * transaction after `migrate`). Idempotent: a second call keeps the original
   * timestamp (TC-15). Returns whether this call created the board.
   */
  markCreated(now: number): boolean {
    const before = this.createdAt();
    if (before !== undefined) return false;
    this.sql(`INSERT INTO storage_meta (key, value) VALUES ('created_at', ?)`, String(now));
    return true;
  }

  private get throughSeq(): number {
    const row = this.sql(`SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`).toArray()[0];
    return row ? Number.parseInt(String(row['value']), 10) : 0;
  }

  /** Row count of the live log (for tests / the room's bookkeeping). */
  get logRowCount(): number {
    return this.rowCount;
  }

  /**
   * Create tables and meta keys if absent. Writes NO update/snapshot rows
   * (TC-25): a never-edited board that is merely opened stays empty.
   */
  migrate(): void {
    const sql = { exec: (query: string, ...bindings: unknown[]) => this.sql(query, ...bindings) };
    sql.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
    );
    sql.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)`,
      String(STORAGE_SCHEMA_VERSION),
    );
    sql.exec(
      `INSERT OR IGNORE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '0')`,
    );
    this.refreshCounters();
  }

  /** Count/sum the log rows above the snapshot watermark. */
  private refreshCounters(): void {
    try {
      const row = this.sql(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(bytes), 0) AS total FROM updates WHERE seq > ?`,
        this.throughSeq,
      ).toArray()[0];
      this.rowCount = row ? Number(row['cnt']) : 0;
      this.byteTotal = row ? Number(row['total']) : 0;
    } catch {
      this.rowCount = 0;
      this.byteTotal = 0;
    }
  }

  /**
   * Append an update to the log. Throws on SQL failure (the room then resets
   * itself — design "Storage failure resets the room").
   */
  append(update: Uint8Array): void {
    // Lazy migrate: a board that already has tables (created via `initialize`,
    // or a legacy board) is not migrated again; one that somehow has no tables
    // gets them now, before its first write.
    if (!this.hasTables()) this.migrate();
    this.sql(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, asBlob(update), update.byteLength);
    this.rowCount += 1;
    this.byteTotal += update.byteLength;
  }

  /**
   * Load the board into `doc`: snapshot chunks first, then log rows above the
   * watermark. A damaged *log row* is quarantined and skipped; a damaged
   * *snapshot* or a SQL failure fails the whole load (the room must not serve
   * a misleadingly empty board).
   */
  load(doc: Y.Doc): LoadResult {
    testHooks.loadAttempts += 1;
    // Missing tables = a board that was never created and holds no data. Treat
    // it as an empty board WITHOUT creating anything (design "Story 4 change").
    if (!this.hasTables()) return { ok: true, quarantined: 0 };
    try {
      const sql = { exec: (query: string, ...bindings: unknown[]) => this.sql(query, ...bindings) };

      // --- Snapshot ---
      const chunkRows = sql.exec(`SELECT data FROM snapshot_chunks ORDER BY idx`).toArray();
      if (chunkRows.length > 0) {
        const chunks = chunkRows.map((r) => new Uint8Array(r['data'] as ArrayBuffer));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(
            JSON.stringify({ level: 'error', event: 'snapshot-unreadable', error: errorMsg }),
          );
          // Nothing is deleted or quarantined on snapshot damage (TC-10).
          return { ok: false, reason: 'snapshot-unreadable', error: errorMsg };
        }
      }

      // --- Log ---
      const through = this.throughSeq;
      const rows = this.sql(`SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq`, through)
        .toArray();

      let quarantined = 0;
      for (const row of rows) {
        const seq = Number(row['seq']);
        const bytes = new Uint8Array(row['data'] as ArrayBuffer);
        try {
          Y.applyUpdate(doc, bytes, LOAD_ORIGIN);
        } catch (e) {
          // Damaged row: quarantine it and keep the rest (TC-09).
          const errorMsg = e instanceof Error ? e.message : String(e);
          try {
            this.storage.transactionSync(() => {
              this.sql(
                `INSERT OR IGNORE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
                seq,
                row['data'],
                errorMsg,
                Date.now(),
              );
              this.sql(`DELETE FROM updates WHERE seq = ?`, seq);
            });
          } catch {
            // Could not quarantine; skip the row but count it.
          }
          quarantined += 1;
        }
      }

      this.refreshCounters();
      return { ok: true, quarantined };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({ level: 'error', event: 'sql-error-on-load', error: errorMsg }),
      );
      return { ok: false, reason: 'sql-error', error: errorMsg };
    }
  }

  /**
   * Compact the log into a chunked snapshot inside one transaction. Never
   * throws: a failure rolls back and returns false (TC-11).
   *
   * `force` skips the thresholds; only the test hooks use it, to turn a small
   * live board into a snapshot the test can then damage.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.rowCount, this.byteTotal)) return false;

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);
      if (chunks.length === 0) return false;

      const through = this.throughSeq;
      const row = this.sql(`SELECT MAX(seq) AS maxSeq FROM updates WHERE seq > ?`, through).toArray()[0];
      const maxSeq = row ? row['maxSeq'] : null;
      if (maxSeq === null || maxSeq === undefined) return false;
      const truncateTo = Number(maxSeq);

      this.storage.transactionSync(() => {
        this.sql(`DELETE FROM snapshot_chunks`);
        for (let i = 0; i < chunks.length; i++) {
          this.sql(
            `INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`,
            i,
            asBlob(chunks[i] as Uint8Array),
          );
        }
        this.sql(`DELETE FROM updates WHERE seq <= ?`, truncateTo);
        this.sql(
          `UPDATE storage_meta SET value = ? WHERE key = 'snapshot_through_seq'`,
          String(truncateTo),
        );
      });

      this.refreshCounters();
      return true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({ level: 'error', event: 'compaction-failed', error: errorMsg }),
      );
      // `transactionSync` rolled the transaction back; log intact (TC-11).
      return false;
    }
  }
}