/**
 * Board storage (story 4, `persist.board_store`).
 *
 * Persists a board's Yjs update stream to the Durable Object's SQLite
 * storage: every accepted update is appended to the `updates` log, and once
 * the log grows past a threshold it is compacted into a chunked snapshot.
 * On wake the store reloads the document (snapshot + log tail); a damaged
 * log row is quarantined, while an unreadable snapshot is fatal (LoadFailed).
 *
 * The pure helpers (`chunkBytes`, `joinChunks`, `shouldCompact`) and the
 * storage interface are deliberately free of `cloudflare:workers` imports so
 * they unit-test in a plain node environment; the real `DurableObjectStorage`
 * satisfies `BoardStorage` structurally.
 */
import * as Y from 'yjs';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../shared/config';

/**
 * The minimal surface of Durable Object SQLite storage BoardStore uses. A
 * portable structural type (no `cloudflare:workers` import) so this module
 * type-checks and runs outside the Workers runtime; the real
 * `DurableObjectStorage` is assignable to it.
 */
export interface BoardStorage {
  sql: {
    exec(query: string, ...bindings: unknown[]): {
      toArray(): Array<Record<string, unknown>>;
      one(): Record<string, unknown>;
    };
  };
  transactionSync<T>(closure: () => T): T;
}

/** Result of loading persisted state into a document. */
export type LoadResult =
  | {
      ok: true;
      quarantined: number;
      /** Rows remaining in the updates log after quarantine. */
      logCount: number;
      /** Total bytes of those rows. */
      logBytes: number;
    }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/** Transaction origin for updates applied while loading persisted state. */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6.load');

/**
 * Split `data` into consecutive chunks of at most `size` bytes. Zero-length
 * input yields zero chunks; a single byte yields one chunk.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) {
    chunks.push(data.subarray(offset, offset + size));
  }
  return chunks;
}

/** Rejoin `chunks` into one byte-identical `Uint8Array` (inverse of chunkBytes). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * True when the update log should be compacted: at least `COMPACTION_UPDATE_COUNT`
 * rows or at least `COMPACTION_BYTES` total log bytes (either boundary, inclusive).
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

const META_SCHEMA_VERSION = 'storage_schema_version';
const META_THROUGH_SEQ = 'snapshot_through_seq';

/**
 * workerd's storage.sql returns BLOBs as ArrayBuffer (writes accept
 * Uint8Array); normalise reads to Uint8Array.
 */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`unexpected BLOB representation: ${String(value)}`);
}

/**
 * One board's durable state: the `updates` log, the chunked `snapshot`, the
 * `quarantined_updates` holding, and the `storage_meta` version/progress keys.
 */
export class BoardStore {
  constructor(private readonly storage: BoardStorage) {}

  /**
   * Read-only existence check (story 5, share.legacy_boards).
   *
   * A board exists if `storage_meta.created_at` is set, or (legacy) it has
   * at least one row in `updates` or `snapshot_chunks`. Queries
   * `sqlite_master` first so probing an unknown id never creates tables.
   */
  existsReadOnly(): boolean {
    const sql = this.storage.sql;
    const tableRows = sql
      .exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('storage_meta','updates','snapshot_chunks')",
      )
      .toArray();
    const tableNames = new Set(tableRows.map((r) => r.name as string));
    if (tableNames.size === 0) return false;

    if (tableNames.has('storage_meta')) {
      const metaRows = sql.exec("SELECT value FROM storage_meta WHERE key = 'created_at'").toArray();
      if (metaRows.length > 0) return true;
    }
    if (tableNames.has('updates')) {
      const row = sql.exec('SELECT COUNT(*) AS c FROM updates').one();
      if ((row.c as number) > 0) return true;
    }
    if (tableNames.has('snapshot_chunks')) {
      const row = sql.exec('SELECT COUNT(*) AS c FROM snapshot_chunks').one();
      if ((row.c as number) > 0) return true;
    }
    return false;
  }

  /** Test seam: set a flag that makes the next initialize() throw. */
  setFailInitializeFlag(): void {
    this.setMeta('_test_fail_initialize', '1');
  }

  /** Test seam: clear the fail-initialize flag. */
  clearFailInitializeFlag(): void {
    this.setMeta('_test_fail_initialize', '');
  }

  /** Test seam: check if initialize() should throw. */
  getFailInitializeFlag(): boolean {
    if (!this.hasTables()) return false;
    return this.getMeta('_test_fail_initialize') === '1';
  }

  /** Epoch ms when the board was created, or null if never initialised. */
  getCreatedAt(): number | null {
    if (!this.hasTables()) return null;
    const raw = this.getMeta('created_at');
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** Set the board's creation timestamp (called once by initialize()). */
  setCreatedAt(epochMs: number): void {
    this.setMeta('created_at', String(epochMs));
  }

  /** True when any of the board's tables exist in sqlite_master. */
  private hasTables(): boolean {
    const rows = this.storage.sql
      .exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('storage_meta','updates','snapshot_chunks')",
      )
      .toArray();
    return rows.length > 0;
  }

  /** Create the tables and set `storage_schema_version` if absent (no rows). */
  migrate(): void {
    const sql = this.storage.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS updates (
         seq   INTEGER PRIMARY KEY AUTOINCREMENT,
         data  BLOB NOT NULL,
         bytes INTEGER NOT NULL
       )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (
         idx  INTEGER PRIMARY KEY,
         data BLOB NOT NULL
       )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (
         seq           INTEGER PRIMARY KEY,
         data          BLOB NOT NULL,
         error         TEXT NOT NULL,
         quarantined_at INTEGER NOT NULL
       )`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
    );
    if (this.getMeta(META_SCHEMA_VERSION) === null) {
      this.setMeta(META_SCHEMA_VERSION, '1');
    }
  }

  /**
   * Append one update to the log. Rethrows SQL errors (caller resets the
   * room). Lazily migrates if tables do not exist (legacy boards that had
   * data written before this feature shipped may have tables already; a
   * fresh board that was initialised will have tables from initialize()).
   */
  append(update: Uint8Array): void {
    if (!this.hasTables()) {
      this.migrate();
    }
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        'INSERT INTO updates (data, bytes) VALUES (?1, ?2)',
        update,
        update.byteLength,
      );
    });
  }

  /**
   * Load snapshot + log tail into `doc`; quarantine damaged log rows.
   * Treats missing tables as an empty board without creating them (story 5:
   * probing unknown links writes nothing).
   */
  load(doc: Y.Doc): LoadResult {
    try {
      if (!this.hasTables()) {
        return { ok: true, quarantined: 0, logCount: 0, logBytes: 0 };
      }

      const throughSeq = this.getThroughSeq();
      if (throughSeq > 0) {
        // A recorded snapshot must be present and contiguous; anything else
        // is an unreadable snapshot (fatal, LoadFailed — never guessed at).
        const rows = this.storage.sql
          .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
          .toArray();
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.idx !== i) {
            return {
              ok: false,
              reason: 'snapshot-unreadable',
              error: `snapshot chunk ${i} missing (found ${String(row.idx)})`,
            };
          }
          chunks.push(asBytes(row.data));
        }
        if (chunks.length === 0) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: 'snapshot_through_seq set but no snapshot_chunks rows',
          };
        }
        let snapshot: Uint8Array;
        try {
          snapshot = joinChunks(chunks);
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (err) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: `snapshot did not decode: ${String(err)}`,
          };
        }
      }

      // The log tail: every row after the snapshot. A row that fails to
      // apply is quarantined and loading continues with the rest.
      let quarantined = 0;
      let logCount = 0;
      let logBytes = 0;
      const rows = this.storage.sql
        .exec('SELECT seq, data, bytes FROM updates WHERE seq > ?1 ORDER BY seq', throughSeq)
        .toArray();
      for (const row of rows) {
        const data = asBytes(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          logCount += 1;
          logBytes += row.bytes as number;
        } catch (err) {
          quarantined += 1;
          this.quarantine(row.seq as number, data, `apply-update-failed: ${String(err)}`);
        }
      }
      return { ok: true, quarantined, logCount, logBytes };
    } catch (err) {
      return { ok: false, reason: 'sql-error', error: String(err) };
    }
  }

  /**
   * Compact the log into a chunked snapshot when past the threshold.
   * Scans the log for its size (callers who already know the size should
   * use `compact` instead, which avoids the scan). Atomic: on any error
   * the transaction rolls back, the log is untouched, and false is
   * returned (never throws).
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    const stats = this.logStats();
    if (!shouldCompact(stats.count, stats.bytes)) return false;
    return this.compact(doc);
  }

  /**
   * Compact the log into a chunked snapshot unconditionally (an empty log
   * is a no-op that returns true). The log's max seq is read with a single
   * scan. Atomic: on any error the transaction rolls back, the log is
   * untouched, and false is returned (never throws).
   */
  compact(doc: Y.Doc): boolean {
    const maxSeqRow = this.storage.sql.exec('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM updates').one();
    const maxSeq = maxSeqRow.maxSeq as number;
    if (maxSeq === 0) return true;

    let snapshot: Uint8Array;
    try {
      snapshot = Y.encodeStateAsUpdate(doc);
    } catch {
      return false;
    }
    const chunks = chunkBytes(snapshot);
    const throughSeq = maxSeq;

    try {
      this.storage.transactionSync(() => {
        const sql = this.storage.sql;
        sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i += 1) {
          sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?1, ?2)', i, chunks[i]);
        }
        sql.exec('DELETE FROM updates');
        this.setMeta(META_THROUGH_SEQ, String(throughSeq));
      });
      return true;
    } catch {
      // The transaction rolled back; the log is exactly as before.
      return false;
    }
  }

  /** Row count, total log bytes, and the highest seq (for tests and compaction). */
  logStats(): { count: number; bytes: number; maxSeq: number } {
    const row = this.storage.sql
      .exec(
        'SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(MAX(seq), 0) AS maxSeq FROM updates',
      )
      .one();
    return {
      count: row.count as number,
      bytes: row.bytes as number,
      maxSeq: row.maxSeq as number,
    };
  }

  /** Number of rows moved to the quarantine holding (for tests and logging). */
  quarantinedCount(): number {
    const row = this.storage.sql.exec('SELECT COUNT(*) AS count FROM quarantined_updates').one();
    return row.count as number;
  }

  private getMeta(key: string): string | null {
    // .one() throws on zero rows in workerd; toArray() does not.
    const [row] = this.storage.sql
      .exec('SELECT value FROM storage_meta WHERE key = ?1', key)
      .toArray();
    return row === undefined || row.value === undefined ? null : (row.value as string);
  }

  private setMeta(key: string, value: string): void {
    this.storage.sql.exec('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?1, ?2)', key, value);
  }

  private getThroughSeq(): number {
    const raw = this.getMeta(META_THROUGH_SEQ);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /**
   * Move a damaged log row out of `updates` into `quarantined_updates` (the
   * raw bytes are kept for forensics/replay). Atomic: either both the delete
   * and the insert land, or neither does. The row's `seq` becomes the
   * quarantine key, so the same row can never be quarantined twice.
   */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      sql.exec('DELETE FROM updates WHERE seq = ?1', seq);
      sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?1, ?2, ?3, ?4)',
        seq,
        data,
        error,
        Date.now(),
      );
    });
  }
}
