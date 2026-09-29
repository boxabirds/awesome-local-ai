/**
 * BoardStore: SQLite-backed persistence for a board's Yjs updates.
 *
 * Provides chunked snapshot storage, an append-only update log, quarantine
 * for damaged rows, and compaction.
 */

import * as Y from 'yjs';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/** Result of loading a board from storage into a doc. */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split `data` into chunks of at most `size` bytes.
 * Returns 0 chunks for empty input, 1 for data <= size, etc.
 */
export function chunkBytes(data: Uint8Array, size?: number): Uint8Array[] {
  const chunkSize = size ?? SNAPSHOT_CHUNK_BYTES;
  if (data.byteLength === 0) return [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.byteLength) {
    chunks.push(data.slice(offset, offset + chunkSize));
    offset += chunkSize;
  }
  return chunks;
}

/**
 * Concatenate chunks back into a single Uint8Array.
 */
export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
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
 * Whether compaction should be triggered.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

const LOAD_ORIGIN = '__vidi6_load__';

/**
 * The persistent store for one board. Uses Durable Object SQL storage
 * (synchronous via storage.sql and storage.transactionSync).
 */
export class BoardStore {
  private sql: SqlStorage;
  private transactionSync: (fn: () => void) => void;
  private updateCount = 0;
  private updateBytes = 0;

  constructor(storage: DurableObjectStorage) {
    this.sql = storage.sql;
    this.transactionSync = (fn) => storage.transactionSync(fn);
  }

  /**
   * Create tables if they do not exist. Sets storage_schema_version if absent.
   * Writes no update rows.
   */
  migrate(): void {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
    );
    // Set schema version if absent
    const rows = this.sql.exec<{ value: string }>(
      `SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`,
    ).toArray();
    if (rows.length === 0) {
      this.sql.exec(
        `INSERT INTO storage_meta (key, value) VALUES ('storage_schema_version', ?)`,
        String(STORAGE_SCHEMA_VERSION),
      );
    }
  }

  /**
   * Append an update to the log. Throws on SQL failure.
   */
  append(update: Uint8Array): void {
    const bytes = update.byteLength;
    this.sql.exec(
      `INSERT INTO updates (data, bytes) VALUES (?, ?)`,
      update,
      bytes,
    );
    this.updateCount++;
    this.updateBytes += bytes;
  }

  /**
   * Load the board state into `doc` from snapshot + update log.
   * Damaged log rows are quarantined. Returns a LoadResult.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Load snapshot chunks
      const chunkRows = this.sql.exec<{ idx: number; data: Uint8Array }>(
        `SELECT idx, data FROM snapshot_chunks ORDER BY idx`,
      ).toArray();

      if (chunkRows.length > 0) {
        const chunks = chunkRows.map((r) =>
          r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data as unknown as ArrayBuffer),
        );
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // Get snapshot_through_seq
      const metaRows = this.sql.exec<{ value: string }>(
        `SELECT value FROM storage_meta WHERE key = 'snapshot_through_seq'`,
      ).toArray();
      const throughSeq = metaRows.length > 0 ? Number(metaRows[0].value) : 0;

      // Load updates after snapshot_through_seq
      const updateRows = this.sql.exec<{ seq: number; data: Uint8Array; bytes: number }>(
        `SELECT seq, data, bytes FROM updates WHERE seq > ? ORDER BY seq`,
        throughSeq,
      ).toArray();

      let quarantined = 0;
      for (const row of updateRows) {
        const data = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data as unknown as ArrayBuffer);
        try {
          Y.applyUpdate(doc, data, LOAD_ORIGIN);
        } catch (e) {
          // Quarantine this row
          const errorMsg = e instanceof Error ? e.message : String(e);
          try {
            this.transactionSync(() => {
              this.sql.exec(
                `INSERT INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)`,
                row.seq,
                data,
                errorMsg,
                Date.now(),
              );
              this.sql.exec(`DELETE FROM updates WHERE seq = ?`, row.seq);
            });
          } catch {
            // If quarantine itself fails, skip the row silently
          }
          quarantined++;
          console.error(JSON.stringify({ event: 'quarantine', seq: row.seq, error: errorMsg }));
        }
      }

      // Track counts for compaction threshold
      const remainingUpdates = this.sql.exec<{ cnt: number; total: number }>(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(bytes), 0) as total FROM updates WHERE seq > ?`,
        throughSeq,
      ).toArray();
      this.updateCount = remainingUpdates.length > 0 ? remainingUpdates[0].cnt : 0;
      this.updateBytes = remainingUpdates.length > 0 ? remainingUpdates[0].total : 0;

      return { ok: true, quarantined };
    } catch (e) {
      return {
        ok: false,
        reason: 'sql-error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Compact the update log into a snapshot if thresholds are reached.
   * Never throws; returns false on no-op or rolled-back failure.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.updateCount, this.updateBytes)) return false;
    return this.compact(doc);
  }

  /** Force compaction regardless of thresholds. Used by test hooks only. */
  compact(doc: Y.Doc): boolean {
    const fullState = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(fullState);

    // Find the max seq in updates
    const maxRows = this.sql.exec<{ maxSeq: number | null }>(
      `SELECT MAX(seq) as maxSeq FROM updates`,
    ).toArray();
    const maxSeq = maxRows[0]?.maxSeq ?? 0;

    try {
      this.transactionSync(() => {
        // Delete old snapshot chunks
        this.sql.exec(`DELETE FROM snapshot_chunks`);
        // Insert new chunks
        for (let i = 0; i < chunks.length; i++) {
          this.sql.exec(
            `INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`,
            i,
            chunks[i],
          );
        }
        // Delete all updates up to and including maxSeq
        if (maxSeq > 0) {
          this.sql.exec(`DELETE FROM updates WHERE seq <= ?`, maxSeq);
        }
        // Update snapshot_through_seq
        this.sql.exec(
          `INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)`,
          String(maxSeq),
        );
      });
      this.updateCount = 0;
      this.updateBytes = 0;
      return true;
    } catch (e) {
      console.error(JSON.stringify({ event: 'compaction-failure', error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }

  /** Test-only: exposed for test hooks. Not accessible outside TEST_HOOKS routes. */
  sqlForTest(query: string, ...args: unknown[]): SqlStorageCursor {
    return this.sql.exec(query, ...args);
  }
}
