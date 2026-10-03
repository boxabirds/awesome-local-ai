/**
 * BoardStore: SQLite-backed persistence for a board's Yjs document.
 *
 * - Appends every Yjs update as a row in the `updates` table.
 * - Loads a doc by replaying the snapshot (if any) then the log rows after
 *   the snapshot's `through_seq`. Damaged log rows are quarantined.
 * - Compacts the log into a chunked snapshot when thresholds are reached.
 *
 * All SQL is synchronous (Durable Object SQLite).
 * Uses the `storage.sql.exec(query, ...bindings)` API and `storage.transactionSync`.
 */

import * as Y from 'yjs';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  STORAGE_SCHEMA_VERSION,
} from '../shared/config';

/**
 * Origin marker for updates applied during load (not stored or broadcast).
 */
export const LOAD_ORIGIN = Symbol('LOAD_ORIGIN');

/**
 * Result of loading a doc from storage.
 */
export type LoadResult =
  | { ok: true; quarantined: number }
  | { ok: false; reason: 'snapshot-unreadable' | 'sql-error'; error: string };

/**
 * Split a byte array into chunks of at most `size` bytes.
 * Returns an empty array for empty input.
 */
export function chunkBytes(data: Uint8Array, size: number = SNAPSHOT_CHUNK_BYTES): Uint8Array[] {
  if (data.byteLength === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.byteLength; i += size) {
    chunks.push(data.subarray(i, Math.min(i + size, data.byteLength)));
  }
  return chunks;
}

/**
 * Join an array of byte chunks back into a single byte array.
 */
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
 * Should we compact? True when the log has at least `COMPACTION_UPDATE_COUNT`
 * rows OR at least `COMPACTION_BYTES` bytes.
 */
export function shouldCompact(count: number, bytes: number): boolean {
  return count >= COMPACTION_UPDATE_COUNT || bytes >= COMPACTION_BYTES;
}

/**
 * BoardStore: one instance per board (one per Durable Object).
 */
/**
 * Minimal interface for the Durable Object storage API we use.
 * Avoids depending on the full DurableObjectStorage type which may not
 * be available in all type-checking contexts.
 */
interface BoardStorage {
  sql: {
    exec(query: string, ...bindings: unknown[]): {
      one(): unknown;
      toArray(): unknown[];
    };
    readonly databaseSize: number;
  };
  transactionSync<T>(fn: () => T): T;
}

export class BoardStore {
  private storage: BoardStorage;
  private updateCount = 0;
  private updateBytes = 0;

  constructor(storage: BoardStorage) {
    this.storage = storage;
  }

  /**
   * Create tables if they don't exist and set the schema version if absent.
   * Writes no update rows.
   */
  migrate(): void {
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined_updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL, error TEXT NOT NULL, quarantined_at INTEGER NOT NULL);
    `);
    // Set schema version if absent
    const existing = this.storage.sql.exec(
      'SELECT value FROM storage_meta WHERE key = ?', 'storage_schema_version'
    ).toArray() as { value: string }[];
    if (existing.length === 0) {
      this.storage.sql.exec(
        'INSERT INTO storage_meta (key, value) VALUES (?, ?)',
        'storage_schema_version', String(STORAGE_SCHEMA_VERSION)
      );
    }
  }

  /**
   * Append a Yjs update to the log. Throws on SQL failure.
   */
  append(update: Uint8Array): void {
    this.storage.sql.exec(
      'INSERT INTO updates (data, bytes) VALUES (?, ?)',
      update, update.byteLength
    );
    this.updateCount += 1;
    this.updateBytes += update.byteLength;
  }

  /**
   * Load the doc from storage: apply the snapshot (if any), then replay log
   * rows with seq > snapshot_through_seq. Damaged log rows are quarantined.
   * Returns a LoadResult.
   */
  load(doc: Y.Doc): LoadResult {
    try {
      // Read and apply snapshot
      const chunkRows = this.storage.sql.exec(
        'SELECT data FROM snapshot_chunks ORDER BY idx'
      ).toArray() as { data: ArrayBuffer }[];

      if (chunkRows.length > 0) {
        const chunks = chunkRows.map((r) => new Uint8Array(r.data));
        const snapshotBytes = joinChunks(chunks);
        try {
          Y.applyUpdate(doc, snapshotBytes, LOAD_ORIGIN);
        } catch (e) {
          return {
            ok: false,
            reason: 'snapshot-unreadable',
            error: `snapshot apply failed: ${String(e)}`,
          };
        }
      }

      // Read the snapshot_through_seq
      const throughRows = this.storage.sql.exec(
        'SELECT value FROM storage_meta WHERE key = ?', 'snapshot_through_seq'
      ).toArray() as { value: string }[];
      const throughSeq = throughRows.length > 0 ? parseInt(throughRows[0].value, 10) : 0;

      // Replay log rows after the snapshot
      const rows = this.storage.sql.exec(
        'SELECT seq, data FROM updates WHERE seq > ? ORDER BY seq', throughSeq
      ).toArray() as { seq: number; data: ArrayBuffer }[];

      let quarantined = 0;
      for (const row of rows) {
        const updateBytes = new Uint8Array(row.data);
        try {
          Y.applyUpdate(doc, updateBytes, LOAD_ORIGIN);
          this.updateCount += 1;
          this.updateBytes += updateBytes.byteLength;
        } catch (e) {
          // Quarantine this row
          this.storage.transactionSync(() => {
            this.storage.sql.exec(
              'INSERT OR REPLACE INTO quarantined_updates (seq, data, error, quarantined_at) VALUES (?, ?, ?, ?)',
              row.seq, row.data, String(e), Date.now()
            );
            this.storage.sql.exec(
              'DELETE FROM updates WHERE seq = ?', row.seq
            );
          });
          quarantined += 1;
          console.error(
            JSON.stringify({
              event: 'quarantine',
              seq: row.seq,
              error: String(e),
            }),
          );
        }
      }

      return { ok: true, quarantined };
    } catch (e) {
      return {
        ok: false,
        reason: 'sql-error',
        error: `SQL error during load: ${String(e)}`,
      };
    }
  }

  /**
   * Compact the log into a chunked snapshot if thresholds are reached.
   * Never throws; returns false on no-op or rolled-back failure.
   */
  compactIfNeeded(doc: Y.Doc): boolean {
    if (!shouldCompact(this.updateCount, this.updateBytes)) return false;

    try {
      const encoded = Y.encodeStateAsUpdate(doc);
      const chunks = chunkBytes(encoded);

      // Find the max seq in the updates table
      const maxSeqRows = this.storage.sql.exec(
        'SELECT MAX(seq) as max_seq FROM updates'
      ).toArray() as { max_seq: number | null }[];
      const maxSeq = maxSeqRows.length > 0 && maxSeqRows[0].max_seq !== null ? maxSeqRows[0].max_seq : 0;

      this.storage.transactionSync(() => {
        // Delete old chunks
        this.storage.sql.exec('DELETE FROM snapshot_chunks');
        // Insert new chunks
        for (let i = 0; i < chunks.length; i++) {
          this.storage.sql.exec(
            'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
            i, chunks[i]
          );
        }
        // Delete log rows up to maxSeq
        this.storage.sql.exec(
          'DELETE FROM updates WHERE seq <= ?', maxSeq
        );
        // Update snapshot_through_seq
        this.storage.sql.exec(
          'INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)',
          'snapshot_through_seq', String(maxSeq)
        );
      });

      // Reset in-memory counters
      this.updateCount = 0;
      this.updateBytes = 0;

      return true;
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'compaction-failed',
          error: String(e),
        }),
      );
      return false;
    }
  }
}
