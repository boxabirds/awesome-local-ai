/**
 * `BoardStore`: the SQLite-backed persistence layer for a single board's Yjs log
 * (`persist.board_store`). One database per board (one Durable Object per board), with
 * an append-only `updates` log compacted into a chunked `snapshot`.
 *
 * Storage schema (Durable Object SQLite):
 *   storage_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
 *     keys: storage_schema_version, snapshot_through_seq
 *   updates(seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)
 *   snapshot_chunks(idx INTEGER PRIMARY KEY, data BLOB NOT NULL)
 *   quarantined_updates(seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)
 *
 * The Yjs document schema (story 2 `meta.schemaVersion`) is unchanged; `storage_schema_version`
 * versions these tables so future stories can migrate them.
 *
 * All SQL runs synchronously (`storage.sql` + `storage.transactionSync`) inside the Durable
 * Object that owns the board, so an inserted row is durable in the same turn the change was
 * applied and the platform's output gates hold broadcasts until the write is durable.
 */
import * as Y from 'yjs';
import { STORAGE_SCHEMA_VERSION } from '../shared/config.js';
import { chunkBytes, joinChunks, shouldCompact } from './board-store-chunks.js';

// Re-export the pure helpers so the SQLite layer's consumers (and integration tests) keep a
// single import site; their definitions live in `board-store-chunks.ts` (no DO types).
export { chunkBytes, joinChunks, shouldCompact } from './board-store-chunks.js';

/**
 * The origin every load passes to `Y.applyUpdate` so the room can tell a loaded update
 * apart from a live one and neither re-store nor broadcast it. Exported for `board-room`.
 */
export const LOAD_ORIGIN: unique symbol = Symbol('vidi6-load');

/** The outcome of loading a board's saved state into a document. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

const errString = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const CREATE_TABLES = [
  'CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)',
];

/** The `updates.data` blob of SQLite comes back as `ArrayBuffer`; normalise to Uint8Array. */
const asUint8 = (blob: ArrayBuffer | Uint8Array): Uint8Array =>
  blob instanceof Uint8Array ? blob : new Uint8Array(blob);

/** The Durable Object storage handle, derived structurally so it resolves under the
 *  worker program's ambient without naming the (base-invisible) `DurableObjectStorage`
 *  alias: the DOM-lib base project must not pull this file in (it is worker-only). */
type DurableStorage = DurableObjectState['storage'];

/** The persisted SQLite persistence layer for one board. */
export class BoardStore {
  private readonly storage: DurableStorage;
  /** Row count and byte total tracked in memory after load to avoid `COUNT(*)` per write. */
  private logCount = 0;
  private logBytes = 0;

  constructor(storage: DurableStorage) {
    this.storage = storage;
  }

  /** Create the tables if absent and record `storage_schema_version`; writes no log rows. */
  migrate(): void {
    this.storage.transactionSync(() => {
      for (const statement of CREATE_TABLES) this.storage.sql.exec(statement);
      const existing = this.storage.sql
        .exec<{ value: string }>(
          'SELECT value FROM storage_meta WHERE key = ?',
          'storage_schema_version',
        )
        .toArray();
      if (existing.length === 0) {
        this.storage.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
          'storage_schema_version',
          String(STORAGE_SCHEMA_VERSION),
        );
      }
    });
  }

  /**
   * Append one Yjs update to the log. Rethrows any SQL error so the caller can reset the
   * room (persist.save_failure). Tracks the in-memory row count and byte total.
   */
  append(update: Uint8Array): void {
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
      update.byteLength,
    );
    this.logCount += 1;
    this.logBytes += update.byteLength;
  }

  /**
   * Load the board into `doc`: the snapshot first, then every log row whose `seq` is
   * greater than `snapshot_through_seq`. A log row that Yjs rejects is moved to
   * `quarantined_updates` and counted (persist.partial_damage); an unreadable snapshot or
   * an SQL error returns `{ ok: false }` (persist.load_failure) — a snapshot error deletes
   * and quarantines nothing.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Snapshot first.
      const chunkRows = this.storage.sql
        .exec<{ idx: number; data: ArrayBuffer }>(
          'SELECT idx, data FROM snapshot_chunks ORDER BY idx',
        )
        .toArray();
      let throughSeq = 0;
      if (chunkRows.length > 0) {
        const snapshot = joinChunks(chunkRows.map((r: { data: ArrayBuffer }) => asUint8(r.data)));
        try {
          Y.applyUpdate(doc, snapshot, LOAD_ORIGIN);
        } catch (error) {
          return { ok: false, reason: 'snapshot-unreadable', error: errString(error) };
        }
        throughSeq = this.readThroughSeq();
      }

      // Then the log rows written after the snapshot.
      const rows = this.storage.sql
        .exec<{ seq: number; data: ArrayBuffer }>(
          'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq',
          throughSeq,
        )
        .toArray();

      // Seed the in-memory totals from the applied log rows so compaction thresholds
      // track the live log without a `COUNT(*)` per write.
      this.logCount = 0;
      this.logBytes = 0;
      let quarantined = 0;
      for (const row of rows) {
        const data = asUint8(row.data);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
          this.logCount += 1;
          this.logBytes += data.byteLength;
        } catch (error) {
          this.quarantine(row.seq, data, errString(error));
          quarantined += 1;
        }
      }
      return { ok: true, quarantined };
    } catch (error) {
      return { ok: false, reason: 'sql-error', error: errString(error) };
    }
  }

  /** The last `snapshot_through_seq`, or 0 when unset. */
  private readThroughSeq(): number {
    const rows = this.storage.sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq')
      .toArray();
    return rows.length > 0 ? Number(rows[0]!.value) : 0;
  }

  /** Move a damaged log row to `quarantined_updates` in its own transaction. */
  private quarantine(seq: number, data: Uint8Array, error: string): void {
    try {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          'INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
          seq,
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          error,
          Date.now(),
        );
        this.storage.sql.exec('DELETE FROM updates WHERE seq = ?', seq);
      });
    } catch (error_) {
      // A quarantine write itself failed; log it and keep the row in place rather than
      // losing data. The row will simply fail to apply again on a future load.
      console.error('board-store.quarantine-failed', { seq, error: errString(error_) });
    }
  }

  /**
   * Compact the log into a snapshot when {@link shouldCompact} says the log is large
   * enough. Runs in one `transactionSync`: replace the chunks with `Y.encodeStateAsUpdate`
   * (the in-memory doc already contains snapshot + log), delete every log row up to the
   * current max seq, and record `snapshot_through_seq`. On any statement error the
   * transaction rolls back (previous snapshot and log intact); never throws — a failure
   * logs and returns `false`, as does a no-op.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.logCount, this.logBytes)) return false;

    const encoded = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(encoded);
    try {
      const maxSeq = this.storage.transactionSync((): number => {
        const row = this.storage.sql.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM updates').one();
        const max = row.m ?? 0;
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          this.storage.sql.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
            i,
            chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
          );
        }
        if (max > 0) this.storage.sql.exec('DELETE FROM updates WHERE seq <= ?', max);
        this.storage.sql.exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          String(max),
        );
        return max;
      });
      // The log is now empty (folded into the snapshot) and the snapshot reflects the doc.
      this.logCount = 0;
      this.logBytes = 0;
      void maxSeq;
      return true;
    } catch (error) {
      // Rolled back: the previous chunks and every log row are unchanged.
      console.error('board-store.compaction-failed', { error: errString(error) });
      return false;
    }
  }

  // --- read helpers used by tests / diagnostics (no side effects) ---

  /**
   * TEST ONLY (reached solely through the room's `env.TEST_HOOKS`-gated endpoint, never in
   * production): write an unreadable snapshot so the next {@link load} fails fatally
   * (`snapshot-unreadable`) rather than quarantining a single log row. The update log is left
   * intact underneath, so {@link repairSnapshotForTest} reveals it again.
   */
  corruptSnapshotForTest(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM snapshot_chunks');
      this.storage.sql.exec(
        'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        0,
        new Uint8Array([0xff, 0xff, 0xff, 0xff]).buffer,
      );
    });
  }

  /** TEST ONLY: drop the injected snapshot so a load replays the (intact) update log. */
  repairSnapshotForTest(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM snapshot_chunks');
    });
  }

  /** Number of rows currently in the `updates` log. */
  logRowCount(): number {
    return this.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM updates').one().c;
  }

  /** Number of snapshot chunks currently stored. */
  snapshotChunkCount(): number {
    return this.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM snapshot_chunks').one().c;
  }

  /** Number of quarantined rows currently stored. */
  quarantineCount(): number {
    return this.storage.sql.exec<{ c: number }>('SELECT COUNT(*) AS c FROM quarantined_updates').one().c;
  }

  /** The stored `snapshot_through_seq` (0 when unset): the last log seq folded into the snapshot. */
  snapshotThroughSeq(): number {
    return this.readThroughSeq();
  }

  /** The stored `storage_schema_version`, or null when absent. */
  schemaVersion(): string | null {
    const rows = this.storage.sql
      .exec<{ value: string }>('SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version')
      .toArray();
    return rows.length > 0 ? rows[0]!.value : null;
  }
}
