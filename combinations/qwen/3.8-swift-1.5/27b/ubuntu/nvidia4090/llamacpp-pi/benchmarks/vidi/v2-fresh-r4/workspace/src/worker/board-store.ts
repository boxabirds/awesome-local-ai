/**
 * Board storage for the BoardRoom Durable Object (story 4).
 *
 * SQLite-backed Durable Object storage, one database per board:
 *   storage_meta         key/value (storage_schema_version, snapshot_through_seq)
 *   updates              append-only Yjs update log (seq, data, bytes)
 *   snapshot_chunks      compacted snapshot split into rows (idx, data)
 *   quarantined_updates  log rows that failed to apply on load
 *
 * Contract (persist.board_store):
 *   - `migrate` creates tables and sets storage_schema_version; writes no rows.
 *   - `append` inserts one log row; rethrows SQL errors (caller resets room).
 *   - `load` applies snapshot then log rows to a doc. A damaged log row is
 *     quarantined and counted; an unreadable snapshot or SQL error returns
 *     `ok:false` with nothing deleted.
 *   - `compactIfNeeded` replaces the snapshot and truncates the log in one
 *     transaction; errors roll back and it returns false. Never throws.
 */
import * as Y from 'yjs';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Origin used when applying updates during load (never stored, never broadcast). */
export const LOAD_ORIGIN: unique symbol = Symbol('LOAD_ORIGIN');

/**
 * Chunk fixed-size byte slices for snapshot storage.
 * Last chunk may be shorter; empty input → zero chunks.
 */
export function chunkBytes(data: Uint8Array, chunkSize = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

/** Inverse of chunkBytes (order-preserving). */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Compaction threshold (D3): update count or byte total. */
export function shouldCompact(updateCount: number, updateBytes: number): boolean {
  return updateCount >= COMPACTION_UPDATE_COUNT || updateBytes >= COMPACTION_BYTES;
}

export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

export type FaultPoint =
  | 'append:insert'
  | 'load:apply-snapshot'
  | 'load:apply-row'
  | 'compaction:after-delete-chunks';

export interface BoardStoreOptions {
  /**
   * Test-only fault injection: called before each storage operation phase.
   * Throw to simulate a SQL failure at that point.
   */
  fault?: (point: FaultPoint) => void;
  /**
   * Max number of injected faults (a fault point is hit at most this many
   * times, then it succeeds). Defaults to unlimited.
   */
  faultBudget?: number;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asBytes(value: ArrayBuffer | Uint8Array | null | undefined): Uint8Array | null {
  if (value == null) return null;
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/**
 * BoardStore: SQLite-backed persistence for one board.
 *
 * One instance per BoardRoom (constructed with the room's storage).
 * All methods are synchronous (Durable Object storage is sync).
 */
export class BoardStore {
  private readonly storage: DurableObjectStorage;
  private readonly opts: BoardStoreOptions;
  private updateCount = 0;
  private updateBytes = 0;
  private faultsRemaining: number | null;

  constructor(storage: DurableObjectStorage, opts: BoardStoreOptions = {}) {
    this.storage = storage;
    this.opts = opts;
    this.faultsRemaining = opts.faultBudget == null ? null : opts.faultBudget;
  }

  /**
   * Create tables (if not present) and set storage_schema_version.
   * Idempotent; writes zero log/snapshot rows for a new board.
   */
  migrate(): void {
    this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    );
    this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data BLOB NOT NULL,
        bytes INTEGER NOT NULL
      )`,
    );
    this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (
        idx INTEGER PRIMARY KEY,
        data BLOB NOT NULL
      )`,
    );
    this.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (
        seq INTEGER NOT NULL,
        data BLOB NOT NULL,
        error TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL
      )`,
    );
    this.storage.sql.exec(
      `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(STORAGE_SCHEMA_VERSION),
    );
  }

  /**
   * Append one Yjs update as the next log row.
   * Rethrows SQL errors (the room must enter the storage-failure state).
   */
  append(update: Uint8Array): number {
    this.invokeFault('append:insert');
    if (this.consumeTestFault('test_fail_append')) {
      throw new Error('injected append failure (test)');
    }
    const cursor = this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      update,
      update.length,
    );
    // Last inserted rowid = current max seq
    const row = this.storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one() as {
      m: number | null;
    };
    const seq = row.m ?? 0;
    this.updateCount += 1;
    this.updateBytes += update.length;
    void cursor;
    return seq;
  }

  /**
   * Load the stored board into a (fresh) doc.
   *
   * - LogOnly: apply all log rows in seq order.
   * - SnapshotPlusLog: apply snapshot chunks, then only rows with seq >
   *   snapshot_through_seq.
   *
   * A log row that fails to apply is quarantined (moved to
   * quarantined_updates with the error) and counted; loading continues.
   * An unreadable snapshot or any SQL error returns ok:false and nothing
   * is deleted.
   */
  load(doc: Y.Doc): LoadResult {
    let quarantined = 0;
    try {
      if (this.consumeTestFault('test_fail_load')) {
        return {
          ok: false,
          reason: 'sql-error',
          error: 'injected load failure (test)',
        };
      }
      // 1. Snapshot
      const throughSeq = this.getSnapshotThroughSeq();
      if (throughSeq > 0) {
        this.invokeFault('load:apply-snapshot');
        const rows = this.storage.sql
          .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx')
          .toArray() as Array<{ idx: number; data: ArrayBuffer }>;
        const parts = rows.map((r) => asBytes(r.data)!);
        let snapshotBytes: Uint8Array;
        try {
          snapshotBytes = joinChunks(parts);
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          // Snapshot unreadable: fail the load, delete nothing
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: `snapshot apply failed: ${errorMessage(e)}`,
          };
        }
      }

      // 2. Log rows (only those after the snapshot, in seq order).
      // Materialize first: quarantining a row mutates the table, which would
      // invalidate a live cursor.
      const rows = this.storage.sql
        .exec('SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq)
        .toArray() as Array<{ seq: number; data: ArrayBuffer }>;
      for (const row of rows) {
        const seq = row.seq;
        const data = asBytes(row.data)!;
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          // Quarantine this row and continue
          this.quarantineRow(seq, data, errorMessage(e));
          quarantined += 1;
        }
      }
      // Resync in-memory counters with what is now in the log
      const maxRow = this.storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one() as {
        m: number | null;
      };
      const countRow = this.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one() as {
        c: number;
      };
      const bytesRow = this.storage.sql
        .exec('SELECT COALESCE(SUM(bytes), 0) AS b FROM updates')
        .one() as { b: number };
      this.updateCount = countRow.c;
      this.updateBytes = bytesRow.b;
      void maxRow;
      return { ok: true, quarantined };
    } catch (e) {
      return { ok: false, reason: 'sql-error', error: errorMessage(e) };
    }
  }

  /**
   * Compact if the threshold is met (or force=true): snapshot the doc,
   * replace snapshot_chunks, delete log rows ≤ max seq, record
   * snapshot_through_seq — all in one transaction.
   * Returns true if a compaction happened. Never throws.
   */
  compactIfNeeded(doc: Y.Doc, force = false): boolean {
    if (!force && !shouldCompact(this.updateCount, this.updateBytes)) return false;
    try {
      const state = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(state);
      const maxRow = this.storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one() as {
        m: number | null;
      };
      const maxSeq = maxRow.m ?? 0;

      // NOTE: this workerd runtime calls the transactionSync closure with no
      // arguments; storage accesses made through `this.storage` inside the
      // closure are part of the ambient transaction (verified: writes commit
      // on success and roll back when the closure throws).
      this.storage.transactionSync(() => {
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          this.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', i, chunks[i]);
        }
        this.invokeFault('compaction:after-delete-chunks');
        if (maxSeq > 0) {
          this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', maxSeq);
        }
        this.storage.sql.exec(
          `INSERT INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          String(maxSeq),
        );
      });

      this.updateCount = 0;
      this.updateBytes = 0;
      return true;
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'board-store-compaction-failed',
          error: errorMessage(e),
        }),
      );
      return false;
    }
  }

  private getSnapshotThroughSeq(): number {
    const row = this.storage.sql
      .exec("SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'")
      .next();
    if (row.done) return 0;
    return Number(row.value.value);
  }

  private quarantineRow(seq: number, data: Uint8Array, error: string): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      this.storage.sql.exec(
        'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
        seq,
        data,
        error,
        Date.now(),
      );
    });
    console.error(
      JSON.stringify({
        event: 'board-store-quarantined-update',
        seq,
        error,
      }),
    );
  }

  private invokeFault(point: FaultPoint): void {
    if (!this.opts.fault) return;
    if (this.faultsRemaining != null) {
      if (this.faultsRemaining <= 0) return;
      this.faultsRemaining -= 1;
    }
    this.opts.fault(point);
  }

  /**
   * Test-only dynamic fault: if storage_meta[key] = "1", reset it to "0" and
   * return true (the caller fails once). Order-independent, so tests can set
   * the flag at any time via runInDurableObject.
   */
  private consumeTestFault(key: string): boolean {
    try {
      const row = this.storage.sql
        .exec('SELECT value FROM storage_meta WHERE key = ?', key)
        .next();
      if (!row.done && row.value.value === '1') {
        this.storage.sql.exec('UPDATE storage_meta SET value = ? WHERE key = ?', '0', key);
        return true;
      }
    } catch {
      // storage_meta may not exist yet (pre-migrate); no fault
    }
    return false;
  }
}

/**
 * Create a BoardStore for a room. Test-only fault flags
 * (test_fail_append / test_fail_load in storage_meta) are consumed
 * dynamically by append/load, so they can be set at any time.
 */
export function createBoardStore(storage: DurableObjectStorage): BoardStore {
  return new BoardStore(storage);
}
