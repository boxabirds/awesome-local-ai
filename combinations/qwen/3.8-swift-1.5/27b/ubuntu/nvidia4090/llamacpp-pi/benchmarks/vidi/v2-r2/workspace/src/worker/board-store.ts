import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * BoardStore: persists every Yjs update to Durable Object SQLite.
 *
 * Layout (one database per board):
 * - storage_meta(key, value): storage_schema_version, snapshot_through_seq
 * - updates(seq, data, bytes): the append-only update log
 * - snapshot_chunks(idx, data): the compacted snapshot, split into rows
 * - quarantined_updates(seq, data, error, quarantined_at): damaged log rows
 *
 * The storage dependency is structural so the pure helpers below can be
 * unit-tested without the Cloudflare runtime.
 */

/** Origin marker for updates applied while loading: never stored, never broadcast. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Minimal structural view of DurableObjectStorage used by BoardStore.
 * Uses the object-style SQL API: storage.sql.exec(query, ...bindings) →
 * cursor with .raw() rows. BLOB values come back as ArrayBuffer.
 */
export interface BoardStorage {
  sql: {
    exec(query: string, ...bindings: unknown[]): {
      raw(): Iterable<unknown[]>;
    };
  };
  transactionSync(fn: () => void): void;
}

/** BLOB values from .raw() are ArrayBuffers; normalize to Uint8Array. */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new Error(`expected blob, got ${typeof v}`);
}

/** Splits `data` into slices of at most `size` bytes (0..n chunks). */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) throw new RangeError('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    chunks.push(data.subarray(offset, offset + size > data.length ? data.length : offset + size));
  }
  return chunks;
}

/** Concatenates chunks byte-identically to the original. */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** True when the log has reached the compaction threshold (count or bytes). */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

type SqlValue = string | number | bigint | null | Uint8Array;

export class BoardStore {
  private rowCount = 0;
  private rowBytes = 0;
  private countersReady = false;
  private migrated = false;

  constructor(private storage: BoardStorage) {}

  /** Creates tables if absent and sets storage_schema_version if absent. Writes no update rows. */
  migrate(): void {
    this.execute(
      'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    );
    this.execute(
      'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)'
    );
    this.execute(
      'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)'
    );
    this.execute(
      'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)'
    );
    const existing = this.queryScalar('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version');
    if (existing === undefined) {
      this.execute(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        'storage_schema_version',
        String(STORAGE_SCHEMA_VERSION)
      );
    }
    this.migrated = true;
  }

  /**
   * Story 5 (share.board_api): sets `storage_meta.created_at` (epoch ms)
   * exactly once. `migrate()` must have run first. Called only from the
   * room's `initialize()` RPC, which is the only code path that creates a
   * board's storage.
   */
  markCreated(): void {
    this.execute(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
      'created_at',
      String(Date.now())
    );
  }

  /** Appends one update to the log. Throws on SQL failure (caller resets the room). */
  append(update: Uint8Array): void {
    // Migrate lazily on the first append: a room whose board was never
    // initialized (e.g. a legacy board probed before story 5) gains its
    // tables only when it first stores data. Probing never reaches here.
    if (!this.migrated && !this.hasTables()) this.migrate();
    this.execute('INSERT INTO updates (data, bytes) VALUES (?, ?)', update, update.length);
    this.ensureCounters();
    this.rowCount += 1;
    this.rowBytes += update.length;
  }

  /**
   * Loads the stored board into `doc`: snapshot first (joined chunks), then
   * log rows with seq > snapshot_through_seq in order. A damaged log row is
   * moved to quarantined_updates and counted. SQL and snapshot-apply errors
   * are reported as ok:false — an empty board is never reported on failure.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // A board whose tables do not exist is an empty board. This is
      // read-only: tables are created by initialize() or the first append,
      // so probing an unknown link writes no storage (share.not_found).
      if (!this.hasTables()) {
        return { ok: true, quarantined: 0 };
      }

      // A board that has SOME tables (a legacy board from before story 5)
      // is completed to the full schema here: CREATE TABLE IF NOT EXISTS is
      // idempotent, and this path is only reached for boards that exist.
      this.migrate();

      // 1. Snapshot
      const chunks: Uint8Array[] = [];
      for (const row of this.queryRows('SELECT data FROM snapshot_chunks ORDER BY idx')) {
        chunks.push(toBytes(row[0]));
      }
      if (chunks.length > 0) {
        try {
          Y.applyUpdate(doc, joinChunks(chunks), LOAD_ORIGIN);
        } catch (e) {
          console.error('[board-store] snapshot unreadable', {
            error: e instanceof Error ? e.message : String(e),
          });
          return { ok: false, reason: 'snapshot-unreadable', error: String(e) };
        }
      }

      // 2. Log rows after the snapshot
      const throughSeq = Number(this.queryScalar('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq') ?? 0);
      const rows: Array<{ seq: number; data: Uint8Array }> = [];
      for (const row of this.queryRows('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq)) {
        rows.push({ seq: Number(row[0]), data: toBytes(row[1]) });
      }

      let quarantined = 0;
      for (const { seq, data } of rows) {
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          quarantined += 1;
          const error = e instanceof Error ? e.message : String(e);
          console.error('[board-store] quarantined damaged update', { seq, error });
          this.storage.transactionSync(() => {
            this.execute(
              'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              seq,
              data,
              error,
              Date.now()
            );
            this.execute('DELETE FROM updates WHERE seq = ?', seq);
          });
        }
      }

      // Quarantine may have removed rows: refresh counters lazily.
      this.countersReady = false;
      return { ok: true, quarantined };
    } catch (e) {
      console.error('[board-store] load failed', { error: String(e) });
      return { ok: false, reason: 'sql-error', error: String(e) };
    }
  }

  /**
   * Compacts the log into a chunked snapshot when the threshold is reached.
   * The in-memory doc already contains snapshot + log, so its full encoded
   * state becomes the new snapshot; the log is then truncated at max seq.
   * All writes happen in one transactionSync: any failure rolls back and the
   * previous snapshot and log stay intact. Never throws.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    try {
      this.ensureCounters();
      if (!shouldCompact(this.rowCount, this.rowBytes)) return false;
      this.writeSnapshot(doc);
      return true;
    } catch (e) {
      console.error('[board-store] compaction failed, rolled back', { error: String(e) });
      return false;
    }
  }

  /**
   * Unconditionally writes the doc's full state as the new snapshot and
   * truncates the log at the current max seq. Returns the chunk count.
   * (Used by test hooks to snapshot boards below the compaction threshold.)
   */
  forceCompact(doc: Y.Doc): number {
    return this.writeSnapshot(doc);
  }

  private writeSnapshot(doc: Y.Doc): number {
    const full = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(full);
    const maxSeq = Number(this.queryScalar('SELECT COALESCE(MAX(seq), 0) FROM updates') ?? 0);

    this.storage.transactionSync(() => {
      this.execute('DELETE FROM snapshot_chunks');
      chunks.forEach((chunk, idx) => {
        this.execute('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
      });
      this.execute('DELETE FROM updates WHERE seq <= ?', maxSeq);
      this.execute(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        'snapshot_through_seq',
        String(maxSeq)
      );
    });

    this.rowCount = 0;
    this.rowBytes = 0;
    this.countersReady = true;
    return chunks.length;
  }

  /**
   * Story 5 (share.board_api): read-only existence check. A board exists if
   * its storage has `storage_meta.created_at`, or (legacy boards from before
   * story 5, share.legacy_boards) at least one row in `updates` or
   * `snapshot_chunks`. Queries `sqlite_master` first and never creates
   * tables, so probing links leaves no storage behind.
   */
  existsReadOnly(): boolean {
    const tables = new Set<string>();
    for (const row of this.queryRows("SELECT name FROM sqlite_master WHERE type = 'table'")) {
      tables.add(String(row[0]));
    }
    if (tables.has('storage_meta')) {
      for (const _row of this.queryRows('SELECT value FROM storage_meta WHERE key = ?', 'created_at')) {
        return true;
      }
    }
    if (tables.has('updates') && Number(this.queryScalar('SELECT COUNT(*) FROM updates') ?? 0) > 0) {
      return true;
    }
    if (tables.has('snapshot_chunks') && Number(this.queryScalar('SELECT COUNT(*) FROM snapshot_chunks') ?? 0) > 0) {
      return true;
    }
    return false;
  }

  /** True when any of the board's tables exist (read-only; creates nothing). */
  private hasTables(): boolean {
    for (const _row of this.queryRows(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('storage_meta', 'updates', 'snapshot_chunks', 'quarantined_updates')"
    )) {
      return true;
    }
    return false;
  }

  // --- internals ---------------------------------------------------------

  /** Executes a statement (iterating forces execution of DML/DDL). */
  private execute(query: string, ...params: SqlValue[]): void {
    for (const _row of this.storage.sql.exec(query, ...params).raw()) {
      // DML/DDL: iteration executes the statement
    }
  }

  private queryScalar(query: string, ...params: SqlValue[]): unknown {
    for (const row of this.storage.sql.exec(query, ...params).raw()) {
      return row[0];
    }
    return undefined;
  }

  /** Row count / byte total of the log, cached in memory after load. */
  private ensureCounters(): void {
    if (this.countersReady) return;
    for (const row of this.queryRows('SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM updates')) {
      this.rowCount = Number(row[0]);
      this.rowBytes = Number(row[1]);
      break;
    }
    this.countersReady = true;
  }

  private queryRows(query: string, ...params: SqlValue[]): unknown[][] {
    const out: unknown[][] = [];
    for (const row of this.storage.sql.exec(query, ...params).raw()) {
      out.push(row as unknown[]);
    }
    return out;
  }
}
